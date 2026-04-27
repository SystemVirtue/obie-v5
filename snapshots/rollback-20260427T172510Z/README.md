Rollback snapshot before post-0300 work.

- Branch: 01-01-26-dev
- Git commit: a73a9b7
- Remote tag: rollback-20260427T172510Z
- Remote branch: rollback/20260427T172510Z
- Supabase project: syccqoextpxifmumvxqw
- Supabase function inventory: supabase-functions-list.txt

Notes:
- A schema-only `supabase db dump --schema public` was attempted, but the
  installed Supabase CLI requires Docker for this command and Docker was not
  running on this machine.
- The repository migrations plus this git tag/branch are the rollback reference
  for database/function code. Re-deploy functions from the rollback branch if
  an application rollback is required.
