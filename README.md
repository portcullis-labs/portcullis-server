# Portcullis Server

> **Status:** Under construction

Some digital assets on Stellar are "regulated": the company that issues them has to approve certain transfers before they can happen. Stellar has a standard for this, called SEP-8, where a wallet sends each transfer to an approval server run by the issuer. The reference server published by the Stellar Development Foundation handles a single rule and is marked for testing only. Portcullis Server is an open-source approval server that an issuer configures in a simple file: transfer limits, maximum balances, allowed and blocked accounts, lockup dates, and manual-review thresholds. For each transfer request it checks the rules, adds the steps Stellar needs to briefly authorize the accounts involved, signs only if the request is safe, and records why it decided what it did. Version 0.1 runs on Stellar's test network, covers payments of one regulated asset, and is unaudited. It helps an issuer enforce its own rules; it does not make anyone legally compliant. A companion wallet-side client library, Portcullis Client, is being built in a separate repository.

Portcullis does not make anyone legally compliant.
