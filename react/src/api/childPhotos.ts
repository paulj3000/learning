import * as amplify from './amplify/childPhotos';
import { selectApi } from './select';

/**
 * Child profile photo storage. Django has no photo route (LAI-0904, the
 * presigned flow), so every operation is `childPhotos_unavailable` there and
 * nothing is ever uploaded to Amplify Storage from a Django build.
 */
export interface ChildPhotosApi {
  uploadPhotoObject: typeof amplify.uploadPhotoObject;
  removePhotoObject: typeof amplify.removePhotoObject;
  getPhotoObjectUrl: typeof amplify.getPhotoObjectUrl;
}

export const childPhotosApi: ChildPhotosApi = selectApi<ChildPhotosApi>('childPhotos', {
  amplify: {
    uploadPhotoObject: amplify.uploadPhotoObject,
    removePhotoObject: amplify.removePhotoObject,
    getPhotoObjectUrl: amplify.getPhotoObjectUrl,
  },
});
