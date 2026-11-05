export function isUiPreview() {
  return process.env.NODE_ENV === 'development' && process.env.LOCAL_UI_PREVIEW === '1'
}
