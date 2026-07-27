import Router from 'router'
import cors from 'cors'
import rateLimit from "express-rate-limit";
import requestIp from 'request-ip'
import addonInterface from "./addon.js"
import landingTemplate from "./lib/util/landingTemplate.js"
import StreamProvider from './lib/stream-provider.js'
import { decode } from 'urlencode'
import qs from 'querystring'
import { getManifest } from './lib/util/manifest.js'
import { parseConfiguration } from './lib/util/configuration.js'
import { BadTokenError, BadRequestError, AccessDeniedError } from './lib/util/error-codes.js'
import RealDebrid from './lib/real-debrid.js'

const router = new Router();
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 300, // limit each IP to 300 requests per windowMs
  headers: false,
  keyGenerator: (req) => requestIp.getClientIp(req)
})

router.use(cors())

router.get('/', (_, res) => {
    res.redirect('/configure')
    res.end();
})

router.get(['/configure', '/:configuration/configure'], async (req, res) => {
    const config = parseConfiguration(req.params.configuration)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = `${protocol}://${req.headers.host}`;
    const configValues = { ...config, host };
    const landingHTML = await landingTemplate(addonInterface.manifest, configValues)
    res.setHeader('content-type', 'text/html')
    res.end(landingHTML)
})

router.get(['/manifest.json', '/:configuration/manifest.json'], (req, res) => {
    const config = parseConfiguration(req.params.configuration)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = `${protocol}://${req.headers.host}`;
    const configValues = { ...config, host };
    // For initial install (no configuration) or when ShowCatalog is explicitly disabled, serve manifest without catalogs
    const noCatalogs = Object.keys(config).length === 0 || config.ShowCatalog === false;
    
    // Set proper headers for Stremio compatibility (keeps the CORS fix)
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    res.end(JSON.stringify(getManifest(configValues, noCatalogs)))
})

router.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const urlParts = req.url.split('?')[0].split('/').filter(Boolean);
    let resource, type, id, extra, configStr;

    if (urlParts.length >= 4 && urlParts[urlParts.length - 1].endsWith('.json')) {
        const last = urlParts[urlParts.length - 1].slice(0, -5);
        id = last;
        type = urlParts[urlParts.length - 2];
        resource = urlParts[urlParts.length - 3];
        configStr = urlParts.slice(0, urlParts.length - 3).join('/');
    } else {
        return next();
    }

    const config = parseConfiguration(configStr);
    console.log(`[DEBUG-ROUTE] Parsed config providers: ${config.DebridServices?.map(s => s.provider).join(', ') || 'none'}`);
    extra = req.params?.extra ? qs.parse(req.url.split('/').pop().slice(0, -5)) : {};
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = `${protocol}://${req.headers.host}`;
    const clientIp = requestIp.getClientIp(req);

    // Combine all configuration values properly, including clientIp
    const fullConfig = { ...config, host, clientIp };

    addonInterface.get(resource, type, id, extra, fullConfig)
        .then(async (resp) => {
            if (fullConfig.DebridProvider === 'RealDebrid' && resp && resp.streams) {
                resp.streams = await RealDebrid.validatePersonalStreams(fullConfig.DebridApiKey, resp.streams);
            }

            let cacheHeaders = {
                cacheMaxAge: 'max-age',
                staleRevalidate: 'stale-while-revalidate',
                staleError: 'stale-if-error'
            }

            const cacheControl = Object.keys(cacheHeaders)
                .map(prop => Number.isInteger(resp[prop]) && cacheHeaders[prop] + '=' + resp[prop])
                .filter(val => !!val).join(', ')

            res.setHeader('Cache-Control', `${cacheControl}, public`)
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(resp))
        })
        .catch(err => {
            console.error(err)
            handleError(err, res)
        })
})

router.use((req, res, next) => {
    const fullUrl = req.originalUrl || req.url;
    if (!fullUrl.includes('/resolve/')) return next();

    // URL structure: /resolve/:debridProvider/:debridApiKey/... or /resolve/:debridProvider/...
    const match = fullUrl.match(/\/resolve\/([^/]+)(?:\/([^/]+))?\/(.+)$/);
    if (!match) {
        console.error('[RESOLVER] Failed to match resolve URL prefix format:', fullUrl);
        return res.status(400).send('Invalid resolve URL format');
    }

    let debridProvider = match[1];
    let debridApiKey = match[2];
    let rawTarget = match[3].split('?')[0];

    // Handle 2-part resolve format: /resolve/httpstreaming/https%3A...
    if (!rawTarget.startsWith('http://') && !rawTarget.startsWith('https://') && !rawTarget.includes('%3A%2F%2F')) {
        if (debridApiKey && (debridApiKey.startsWith('http') || debridApiKey.includes('%3A%2F%2F'))) {
            rawTarget = `${debridApiKey}/${rawTarget}`;
            debridApiKey = 'none';
        }
    }

    const decodedUrl = decodeURIComponent(rawTarget);
    const clientIp = requestIp.getClientIp(req);

    if (!decodedUrl || decodedUrl === 'undefined') {
        console.error('[RESOLVER] Missing or invalid URL parameter');
        return res.status(400).send('Missing or invalid URL parameter');
    }

    const cacheKey = typeof req.query.cacheKey === 'string' ? req.query.cacheKey : null;
    const cacheHash = typeof req.query.cacheHash === 'string' ? req.query.cacheHash : null;
    const resolveConfig = {};
    if (cacheKey && cacheKey.length < 512) resolveConfig.cacheKey = cacheKey;
    if (cacheHash && cacheHash.length < 128) resolveConfig.cacheHash = cacheHash;

    StreamProvider.resolveUrl(debridProvider, debridApiKey, null, decodedUrl, clientIp, resolveConfig)
        .then(url => {
            if (url) {
                res.redirect(url);
            } else {
                res.status(404).send('Could not resolve link');
            }
        })
        .catch(err => {
            console.error('[RESOLVER-ERROR]', err);
            handleError(err, res);
        });
});

router.get('/ping', (_, res) => {
    res.statusCode = 200
    res.end()
})

function handleError(err, res) {
    if (err == BadTokenError) {
        res.writeHead(401)
        res.end(JSON.stringify({ err: 'Bad token' }))
    } else if (err == AccessDeniedError) {
        res.writeHead(403)
        res.end(JSON.stringify({ err: 'Access denied' }))
    } else if (err == BadRequestError) {
        res.writeHead(400)
        res.end(JSON.stringify({ err: 'Bad request' }))
    } else {
        res.writeHead(500)
        res.end(JSON.stringify({ err: 'Server error' }))
    }
}

export default function (req, res) {
    router(req, res, function () {
        res.statusCode = 404;
        res.end();
    });
}
