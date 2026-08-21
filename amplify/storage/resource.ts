import { defineStorage } from '@aws-amplify/backend';

/**
 * The first Amplify Storage resource in this backend
 * (docs/ARCHITECTURE.md "Storage": path-based access rules, approved
 * assets only, no arbitrary public uploads).
 *
 * It exists for exactly one thing today: the optional photo a parent may
 * upload as their child's profile icon. That makes it the most sensitive
 * store in the product - a photograph of a child under 8 - so the access
 * rules are deliberately the narrowest Amplify offers:
 *
 * - `allow.entity('identity')` scopes every object to the Cognito
 *   *identity pool* ID of the parent who uploaded it. The `{entity_id}`
 *   token in the path is substituted per-caller at request time, so one
 *   signed-in parent physically cannot read, overwrite, or delete another
 *   family's object, even with a hand-crafted key. This is the storage
 *   equivalent of the `allow.owner()` rule every child-scoped model in
 *   amplify/data/resource.ts already carries.
 * - No `allow.guest` / `allow.authenticated` rule: unauthenticated callers
 *   and *other* signed-in parents get nothing at all.
 * - No `allow.groups(['Admins'])` rule either, unlike the admin-readable
 *   models in amplify/data/resource.ts. An administrator reviewing safety
 *   events or progress has no reason to see a child's face, and
 *   docs/AUTHORIZATION_REVIEW.md's deny-by-default principle means that
 *   access is not granted "just in case" - it would have to be justified,
 *   added here, and re-reviewed.
 * - Uploads are `write` + `delete` only for the owning parent; children
 *   never upload anything (child mode runs inside the parent's session and
 *   the field lives on the parent-only profile form).
 *
 * The image bytes are re-encoded in the browser before they ever reach
 * this bucket (src/features/child-profile/avatarPhoto.ts): cropped to a
 * 256px square JPEG, which caps object size and drops all EXIF metadata,
 * including any GPS coordinates the original camera file carried.
 *
 * Nothing in this bucket is ever read by an AI route. CLAUDE.md section 7
 * ("Do not send full child profiles or unnecessary history to the model")
 * and the safe-context builder in src/features/companion/ pass typed
 * scalars only; no image or image key is part of any prompt context.
 *
 * @see https://docs.amplify.aws/react/build-a-backend/storage/
 */
export const storage = defineStorage({
  name: 'learningAdventureIslandMedia',
  access: (allow) => ({
    'child-photos/{entity_id}/*': [allow.entity('identity').to(['read', 'write', 'delete'])],
  }),
});
