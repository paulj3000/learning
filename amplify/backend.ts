import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

/**
 * Phase 1: parent auth and the ParentProfile/ChildProfile data model.
 * Storage and functions are added in later roadmap phases per docs/ROADMAP.md.
 * @see https://docs.amplify.aws/react/build-a-backend/
 */
defineBackend({
  auth,
  data,
});
