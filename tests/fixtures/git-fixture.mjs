#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const commandIndex = args.findIndex((arg) => arg === 'clone' || arg === 'rev-parse' || arg === 'checkout');
const command = commandIndex >= 0 ? args[commandIndex] : '';

if (command === 'clone') {
  const destination = args.at(-1);
  if (!destination) process.exit(2);
  mkdirSync(join(destination, '.git'), { recursive: true });
  mkdirSync(join(destination, 'zuul-core', 'src'), { recursive: true });
  writeFileSync(join(destination, 'README.md'), 'Netflix Zuul fixture checkout\n');
  writeFileSync(join(destination, 'zuul-core', 'src', 'ProxyEndpoint.java'), 'class ProxyEndpoint { String authorizationBoundary = "zuul routing"; }\n');
  process.exit(0);
}

if (command === 'rev-parse') {
  process.stdout.write('0123456789abcdef0123456789abcdef01234567\n');
  process.exit(0);
}

if (command === 'checkout') {
  process.exit(0);
}

process.stderr.write(`unsupported git fixture args: ${args.join(' ')}\n`);
process.exit(2);
