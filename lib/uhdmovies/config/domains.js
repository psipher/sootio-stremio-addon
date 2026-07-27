import { getProviderDomain } from '../../util/domain-manager.js';

let uhdMoviesDomain = 'https://uhdmovies.casa';

export async function getUHDMoviesDomain() {
  try {
    uhdMoviesDomain = await getProviderDomain('UHDMovies', 'https://uhdmovies.casa');
  } catch (err) {
    console.warn(`[UHDMovies] DomainManager error, using fallback: ${err.message}`);
  }
  return uhdMoviesDomain;
}
