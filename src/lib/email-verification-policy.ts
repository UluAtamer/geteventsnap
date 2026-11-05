// Server-only setting: pending accounts stay unverified so enabling the policy later takes effect.
export function isEmailVerificationRequired() {
  return process.env.EMAIL_VERIFICATION_REQUIRED === 'true'
}
