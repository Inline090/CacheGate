const express = require('express')
const stats = require('../db/stats')

const router = express.Router()

router.get('/summary', async (req, res) => {
  res.json(await stats.summary())
})

router.get('/routes', async (req, res) => {
  res.json(await stats.topRoutes())
})

router.get('/latency', async (req, res) => {
  res.json(await stats.latency())
})

module.exports = router
