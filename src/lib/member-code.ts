export function getMemberCode(userId: string) {
  return `GES-${userId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

export function normalizeMemberCode(value: string) {
  const match = /^(?:GES-?)?([0-9A-F]{8})$/i.exec(value.trim())
  return match ? `GES-${match[1].toUpperCase()}` : null
}
