// Central route aggregator
const express = require('express');
const router = express.Router();

router.use('/v1/llm', require('./llm'));

module.exports = router;
