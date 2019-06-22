#!/usr/bin/env node

const http = require('http')

const opts = {
  host: 'localhost',
  port: 9999,
  timeout: 1000
}

const request = http.request(opts, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1)
})

request.on('error', () => {
  process.exit(1)
})

request.end()
