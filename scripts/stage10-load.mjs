#!/usr/bin/env node

const api = process.env.API_BASE_URL ?? 'http://localhost:8080/api/v1';
const token = process.env.ACCESS_TOKEN;
const clients = Number(process.env.LOAD_CLIENTS ?? 25);
const iterations = Number(process.env.LOAD_ITERATIONS ?? 8);

if (!token) throw new Error('ACCESS_TOKEN is required');
if (!Number.isInteger(clients) || clients < 1 || clients > 200)
  throw new Error('LOAD_CLIENTS must be an integer between 1 and 200');
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100)
  throw new Error('LOAD_ITERATIONS must be an integer between 1 and 100');

const paths = ['/household', '/loyalty/club', '/payments/history', '/config/runtime'];
const durations = [];
let failures = 0;
const started = performance.now();

await Promise.all(
  Array.from({ length: clients }, async (_, client) => {
    for (let iteration = 0; iteration < iterations; iteration++) {
      const path = paths[(client + iteration) % paths.length];
      const before = performance.now();
      try {
        const response = await fetch(`${api}${path}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok) failures++;
        await response.arrayBuffer();
      } catch {
        failures++;
      } finally {
        durations.push(performance.now() - before);
      }
    }
  }),
);

durations.sort((a, b) => a - b);
const percentile = (ratio) =>
  durations[Math.min(durations.length - 1, Math.floor(durations.length * ratio))];
const result = {
  clients,
  iterationsPerClient: iterations,
  requests: durations.length,
  failures,
  wallMs: Math.round(performance.now() - started),
  p50Ms: Math.round(percentile(0.5)),
  p95Ms: Math.round(percentile(0.95)),
  maxMs: Math.round(durations.at(-1) ?? 0),
};
console.log(JSON.stringify(result));
if (failures) process.exitCode = 1;
