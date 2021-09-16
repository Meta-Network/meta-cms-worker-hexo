export const isEmptyObj = (obj: Record<string, unknown>): boolean => {
  return obj && Object.keys(obj).length === 0 && obj.constructor === Object;
};
