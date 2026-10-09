# Weeds for the first deployment

- Private session/principal/grant adapter is not integrated. Private commands fail closed.
- Git public projections are the initial storage profile; no database or financial migration is performed.
- No money movement, automated invoice fulfillment or Nebula host enrollment.
- No measured hyperscale capacity. Load tests, multi-replica rolling-update behavior and geography require separate evidence.
- Production maturity requires the organization's explicit commercial policy and earnings evidence.
- Newly published project IDs need static permalink generation in the client build; existing links remain stable.
- Public snapshots may be cached or exported. Withdrawal cannot recall plaintext already copied.
- Existing Railway production configuration patches are unrelated to this testing deployment.
- Software distribution license is unresolved. Public visibility does not by itself establish a granted software license.
- Resource caps for the pilot constrain runtime per instance, not a complete account spending cap.
- Initial source/port wiring issues were corrected; see DEPLOYMENT.md. Check the resolved commit and domain target rather than trusting a queued build.
- Current publication changes require API and client snapshot commits; new IDs also require static HTML generation. A future single-source publication pipeline is pending.
- Browser UI/cache checks passed through a session HTTPS bridge to real responses. Native external browser transport could not be verified in this session.
- Railway now rejects custom legacy Config as Code paths as deprecated; the client uses current service configuration plus its Dockerfile.
