const DEFAULT_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
}

const sendHeaders = (req, res, code, headers) => {
  code = code || 200
  let hdrs = DEFAULT_HEADERS
  if (headers) {
    hdrs = Object.assign({}, hdrs, headers)
  }
  res.writeHead(200, hdrs)
}

const respond = (req, res, msg, code, headers) => {
  if (msg instanceof Error) {
    msg = `${msg}\n${msg.stack}`
    if (!headers) {
      headers = {}
    } else {
      headers['content-type'] = 'text/plain; charset=UTF-8'
    }
  }
  if (!headers) {
    headers = DEFAULT_HEADERS
  }
  if (typeof msg === 'object') {
    msg = JSON.stringify(msg)
  }
  if (!code) {
    code = 200
  }
  sendHeaders(req, res, code, headers)
  res.end(msg)
}

const error = (req, res, err, code) => {
  respond(req, res, err, code || 500)
}

exports.DEFAULT_HEADERS = DEFAULT_HEADERS
exports.respond = respond
exports.error = error
exports.sendHeaders = sendHeaders
