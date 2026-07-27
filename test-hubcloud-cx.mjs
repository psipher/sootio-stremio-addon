import { resolveHttpStreamUrl } from './lib/http-streams/resolvers/http-resolver.js';

async function testHubcloudCx() {
  const url = 'https://hubcloud.cx/drive/o5o7fnsher5hh75';
  console.log('Testing resolution for Hubcloud CX URL:', url);
  
  try {
    const result = await resolveHttpStreamUrl(url);
    console.log('RESULT:', result);
  } catch (err) {
    console.error('ERROR:', err);
  }
}

testHubcloudCx();
