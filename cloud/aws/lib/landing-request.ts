// Keep this code compatible with the CloudFront Functions JavaScript 2.0 runtime.
// Asset paths match Nuxt's static output and web/public; extend when adding assets.
export function landingRequestCode(domainName: string): string {
  return `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : '';
  var canonical = ${JSON.stringify(domainName)};
  var asset = uri.indexOf('/_nuxt/') === 0 || uri === '/favicon.svg' || uri === '/_payload.json';
  var destination = uri === '/' || asset ? uri : '/';
  if (host !== canonical || destination !== uri) {
    var pairs = [];
    var query = request.querystring || {};
    Object.keys(query).forEach(function(key) {
      var values = query[key].multiValue || [query[key]];
      values.forEach(function(item) { pairs.push(key + '=' + item.value); });
    });
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: {
        location: { value: 'https://' + canonical + destination + (pairs.length ? '?' + pairs.join('&') : '') },
        'cache-control': { value: 'public, max-age=300' }
      }
    };
  }
  return request;
}`
}
