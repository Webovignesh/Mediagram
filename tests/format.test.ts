import assert from 'node:assert/strict'
import test from 'node:test'
import { fmtBytes, fmtDuration } from '../web/src/format.ts'

test('fmtDuration: M:SS, H:MM:SS past an hour, fractions rounded, nonsense reads as nothing', () => {
  assert.equal(fmtDuration(0), '0:00')
  assert.equal(fmtDuration(5), '0:05')
  assert.equal(fmtDuration(59), '0:59')
  assert.equal(fmtDuration(60), '1:00')
  assert.equal(fmtDuration(184), '3:04')
  assert.equal(fmtDuration(245), '4:05')
  // An hour was printed as "60:00" before: minutes ran past 59 with no hour unit.
  assert.equal(fmtDuration(3600), '1:00:00')
  assert.equal(fmtDuration(3661), '1:01:01')
  assert.equal(fmtDuration(3725), '1:02:05')
  assert.equal(fmtDuration(86399), '23:59:59')
  // A fractional duration used to leak its fraction into the seconds field ("2:39.2").
  assert.equal(fmtDuration(159.2), '2:39')
  assert.equal(fmtDuration(59.6), '1:00')
  assert.equal(fmtDuration(-3), '0:00')
  assert.equal(fmtDuration(Number.NaN), '0:00')
})

test('fmtBytes: units, rounding, and a size that is missing or nonsense', () => {
  assert.equal(fmtBytes(0), '0 B')
  assert.equal(fmtBytes(1), '1 B')
  assert.equal(fmtBytes(1024), '1 KB')
  assert.equal(fmtBytes(1536), '1.5 KB')
  assert.equal(fmtBytes(1048576), '1 MB')
  assert.equal(fmtBytes(15728640), '15 MB')
  assert.equal(fmtBytes(4521980), '4.3 MB')
  assert.equal(fmtBytes(2 ** 40), '1 TB')
  // Below a byte, and not a number at all: both used to print "NaN undefined".
  assert.equal(fmtBytes(0.5), '0.5 B')
  assert.equal(fmtBytes(-1), '0 B')
  assert.equal(fmtBytes(Number.NaN), '0 B')
})
