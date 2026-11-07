# Feedback for Chainlink

From building two CRE workflows (`check-coin`, `score-calls`) that write to a `KallVerdicts` contract on Base
Sepolia.

## 1. No easy way to read a Data Feed price at a past minute
Scoring a call needs the price at the minute it was posted and at its deadline. A Data Feed gives the latest
answer, so `score-calls` reads 1-minute candles from an exchange API instead, and the nodes agree on the median.
We still use the Chainlink feed for the entry price, but the exit can't come from it.
**Ask:** a simple read of a feed's price at a given time, in a workflow or on chain.

## 2. The SDK has to sit at the project root when there are several workflows
With more than one workflow in a project, the CRE SDK must be installed at the root. The docs don't say so, and
the error you get doesn't point there.
**Ask:** one line in the multi-workflow docs.

## What worked well
CRE made the verdicts trustless with very little code: every node reads the contract and agrees before anything is
written on chain, and `--broadcast` simulation let us test against the real contract. The transactions are in the
README.
