
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

import { config } from './config.js';
import { getPool } from './db.js';
import {
  getCandles,
  getExchangeStatus
} from './repositories/marketRepository.js';
import { startCollector } from './services/collector.js';

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get('/api/health', async (_req, res) => {
  try {
    await getPool();

    res.json({
      ok: true,
      database: 'connected',
      time: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error.message
    });
  }
});

app.get('/api/candles', async (req, res) => {
  try {
    const timeframe = String(req.query.timeframe || '1m');
    const limit = Number(req.query.limit || 5000);

    const rows = await getCandles(timeframe, limit);

    res.json({
      symbol: 'USDT/IRR',
      currency: 'IRR',
      timeframe,
      data: rows
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/exchanges', async (_req, res) => {
  try {
    res.json(await getExchangeStatus());
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/market/summary', async (_req, res) => {
  try {
    const rows = await getCandles('1m', 2);

    const latest = rows[rows.length - 1];
    const previous = rows[rows.length - 2];

    const change =
      latest && previous && previous.close
        ? ((latest.close - previous.close) / previous.close) * 100
        : null;

    res.json({
      symbol: 'USDT/IRR',
      currency: 'IRR',
      price: latest?.close ?? null,
      changePercent: change,
      updatedAt: latest
        ? new Date(latest.time * 1000).toISOString()
        : null
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: config.corsOrigin
  }
});

io.on('connection', socket => {
  socket.emit('connected', { ok: true });
});

server.listen(config.port, async () => {
  console.log(
    `USDT/RIAL API listening on http://localhost:${config.port}`
  );

  try {
    await getPool();
    startCollector(io);
  } catch (error) {
    console.error(
      'Database connection failed:',
      error.message
    );
  }
});
