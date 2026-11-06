// The exact texts an inviter and an invitee sign. Shared, so the website and
// the server always agree on them.
export const ROLES = { heir: 'heir', child: 'child', nominee: 'nominee', family: 'family member' }
export const inviteMessage = (i) => `Zoza Family: ${i.fromName} invites ${i.name} to be their ${ROLES[i.role]}. Code ${i.code}.`
export const acceptMessage = (i) => `Zoza Family: I accept ${i.fromName}'s invite to be their ${ROLES[i.role]}. Code ${i.code}.`
