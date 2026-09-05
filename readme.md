# Web Loteria - Bitcoin Address Finder

Web Loteria is a tool designed to search for specific Bitcoin puzzle addresses by scanning private-key ranges and checking if the derived addresses match target addresses. This project demonstrates the principles behind Bitcoin cryptography and address generation.

## Play Now

Try it online: [https://lmajowka.github.io/webloteria/](https://lmajowka.github.io/webloteria/)

## Features

- Bitcoin private key generation
- Bitcoin address derivation and verification
- Partition-based search across multiple Web Workers (up to 8 threads)
- Optimized BigInt secp256k1 point-stepping + fast SHA-256/RIPEMD-160
- Real-time processing statistics and speed counter
- Visual feedback through console output
- Intuitive user interface

## How It Works

The application works by:
1. Splitting the selected wallet's key range into contiguous chunks, one per worker
2. Stepping a secp256k1 point through each chunk and hashing each compressed pubkey
3. Checking if any derived hash160 matches the target address(es)
4. Reporting the found private key, statistics, and progress in real-time

## Technical Details

This application is built with pure JavaScript and runs entirely in the browser. It uses a self-contained Web Worker with a hand-written BigInt secp256k1 point-adder and custom SHA-256/RIPEMD-160 to maximize throughput (roughly 1.4M keys/s across 4 threads). Elliptic curve cryptography is performed locally; when a key is found it may be reported to the puzzle pool API (bitcoinpuzzles.io) using the pool token supplied in the UI.

## License

This project is available for educational purposes.

## Disclaimer

This tool is meant for educational and research purposes only. The probability of finding a specific Bitcoin address through random generation is astronomically small.