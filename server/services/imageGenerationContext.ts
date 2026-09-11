import { AsyncLocalStorage } from 'node:async_hooks';
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_MODEL_PRO,
  parseImageModel,
  type ImageModelOption,
} from '../../shared/imageModels.js';

const context = new AsyncLocalStorage<ImageModelOption>();

export function getImageModel(pro = false): ImageModelOption {
  return context.getStore() ?? parseImageModel(pro ? DEFAULT_IMAGE_MODEL_PRO : DEFAULT_IMAGE_MODEL);
}

export function withImageModel<T>(model: ImageModelOption, work: () => T): T {
  return context.run(model, work);
}
