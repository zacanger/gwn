#!/usr/bin/env node

/* eslint-disable no-useless-escape */

require('isomorphic-fetch')

const path = require('path')
const request = require('fetchyeah')
const express = require('express')
const helmet = require('helmet')
const compression = require('compression')

const {
  archive,
  config,
  diff,
  downloadRex,
  getOneFile,
  list,
  listFiles,
  log
} = require('./git')

const app = express()
app.use(helmet())
app.use(compression())

// api
const api = express.Router()
app.use('/-', api)
api.get('/api/list', list)
api.get(downloadRex, archive)
api.get(/\/api\/[^\/`'"'&|<>]*$/, log)
api.get(/\/api\/[^\/`'"'&|<>]*\/[abcdef1234567890]*$/, diff)
api.get(/\/api\/[^\/`'"'&|<>]*\/list$/, listFiles)
api.get(/\/api\/[^\/`'"'&|<>]*\/get\/([^&`'"|<>]*)/, getOneFile)

// views
app.set('view engine', 'pug')
app.set('views', path.resolve(__dirname, 'views'))

const apiUrl = `http://localhost:${config.port}/-/api`

app.get('/', (req, res) => {
  request.getJson(`${apiUrl}/list`)
    .then((repos) =>
      repos.map(({
        name,
        lastCommit: {
          age,
          message,
          author
        }
      }) => ({
        name,
        age,
        message,
        author
      })))
    .then((repos) => {
      res.render('index', { repos })
    })
})

app.get('/:repo', (req, res) => {
  const repo = req.params.repo
  const skip = parseInt((req.query && req.query.skip) || '0', 10)
  if (repo === 'favicon.ico') {
    return
  }
  const next = skip + 100
  const prev = skip - 100 < 0 ? 0 : skip - 100
  request.getJson(`${apiUrl}/${repo}?skip=${skip}`)
    .then((commits) => {
      res.render('repo', { repo, commits, prev, next })
    })
})

app.get('/:repo/commit/:hash', (req, res) => {
  const { repo, hash } = req.params
  request.sendString('GET', `${apiUrl}/${repo}/${hash}`)
    .then((commit) => {
      res.render('commit', { commit, hash, repo })
    })
})

app.get('/:repo/files', (req, res) => {
  const repo = req.params.repo
  request.getJson(`${apiUrl}/${repo}/list`)
    .then((files) => {
      res.render('files', { repo, files })
    })
})

app.get('/:repo/file/:file', (req, res) => {
  const { repo, file } = req.params
  request.sendString(
    'GET',
    `${apiUrl}/${repo}/get/${file}?raw=true`
  )
    .then((content) => {
      res.render('file', { repo, content, file })
    })
})

app.listen(config.port, () => {
  console.log(`gwn listening on ${config.port}`)
})
