-- Migration: normalize all namespace slugs to lowercase
-- This is safe to run multiple times (idempotent).
-- With only 2 rows this is instant, but it would be safe at any scale
-- since slug has a UNIQUE constraint and all our slugs are already
-- distinct when lowercased.

UPDATE namespaces SET slug = LOWER(slug) WHERE slug != LOWER(slug);
