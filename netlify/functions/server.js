// Runs the Express app (server.js) as a Netlify Function. Static files in /public are served by the CDN.
const serverless = require('serverless-http');
const app = require('../../server');

exports.handler = serverless(app, { basePath: '/.netlify/functions/server' });
