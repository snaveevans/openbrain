# @snaveevans/openbrain-common

Shared REST types and internal ports for Open Brain
([ADR-0004](../../docs/decisions/0004-rest-as-domain-surface.md)).

This package is not a runtime. It exports:

- the memory document and HTTP envelopes
- store, embedder, and vector-index ports

Adapters live in the REST Worker. Clients import types only.

## License

[MIT](../../LICENSE). There is no public Open Brain API.
