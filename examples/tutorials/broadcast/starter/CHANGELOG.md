# Changelog

All notable changes to `pricetag` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `EUR` currency in `formatPrice` and the CLI.

### Fixed

- Negative amounts keep the minus sign before the currency symbol.

## [1.2.0] - 2026-09-14

### Added

- `node src/cli.ts --version` prints the package version.

## [1.1.0] - 2026-08-03

### Added

- `formatPrice` rejects fractional cents.
