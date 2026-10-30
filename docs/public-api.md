# Public API (v1): for maintainers

**The developer documentation is generated, not written.** Tenants read
`/developers`; tools read `/api/v1/openapi.json`. Both are built on every
request from the code (`lib/openapi.ts`), so do not describe endpoints,
fields, limits or error codes here: they would drift, and the generated docs
would already be right.

## Where each fact lives

| Fact | Source |
| --- | --- |
| That an endpoint exists, and its path | The route file's location under `app/api/v1`, collected by `scripts/generate-api-index.mts` into `lib/generated/api-routes.ts` before every `dev` and `build` |
| Its scope, summary, query parameters, response | The `publicApi({...})` declaration in that route file. The query schema is what validates requests; the response schema is what the data is checked against |
| What a resource looks like | `lib/api-schemas.ts`. The serializers in `lib/public-api-serializers.ts` are tested against it field for field |
| Error codes | `ERROR_CATALOG` in `lib/public-api.ts` |
| Limits, paging, authentication, signatures | `lib/api-docs-content.ts`, which reads the constants the code enforces |
| Example values shown in the docs | The `examples` on each schema field (`.meta` in `lib/api-schemas.ts`, `lib/decision-hook-contract.ts`); `lib/api-examples.ts` assembles them |
| The pages, their URLs, sidebar, search, code samples | `lib/docs-view.ts` (content and `hrefFor`), `components/developers/` (presentation), `app/developers/[...slug]` (one static page per section) |
| "Was this helpful?" answers | `docsFeedback/{sectionId}`, read at `/superadmin/docs-feedback` (`lib/docs-feedback.ts`) |

## Adding or changing an endpoint

1. Create or edit `app/api/v1/<path>/route.ts` with `export const GET = publicApi({ scope, summary, query, response }, handler)`.
2. Return data through a serializer whose output matches a schema in `lib/api-schemas.ts`.
3. `npm run test:api-docs`. It fails on an undeclared route, a stale index, a missing summary, a broken reference, or an error code missing from the catalog.

That is all. The docs update themselves.

Internals: `lib/public-api.ts` (wrapper, budget, auth), `lib/api-keys.ts`.
Security notes: `docs/auth-and-security.md`. Why it is shaped this way:
`docs/plans/tenant-api-and-hooks.md`.
