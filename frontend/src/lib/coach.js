import { api } from './api.js';
let cache = null;
let cacheAt = 0;
export async function fetchAnalysis(force = false){
  if(!force && cache && Date.now() - cacheAt < 60000) return cache;
  const data = await api('/api/coach/analysis');
  cache = data;
  cacheAt = Date.now();
  return data;
}
export function clearCoachCache(){
  cache = null;
  cacheAt = 0;
}
