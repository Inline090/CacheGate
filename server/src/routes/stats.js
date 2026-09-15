const express = require('express')
const stats = require('../db/stats')

const router = express.Router()

router.get('/summary', async (req, res) => {
  res.json(await stats.summary())
})

module.exports = router
