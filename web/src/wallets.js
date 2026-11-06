// Browser wallets on this page. Wallets announce themselves with EIP-6963, so
// several can be listed by name, even when they load after the page. An older
// wallet that only sets window.ethereum is used as a fallback.
const found = new Map()
const listeners = new Set()

window.addEventListener('eip6963:announceProvider', (e) => {
  const { info, provider } = e.detail ?? {}
  if (!info || !provider) return
  found.set(info.rdns || info.uuid, { id: info.rdns || info.uuid, name: info.name, icon: info.icon, provider })
  listeners.forEach((fn) => fn())
})
window.dispatchEvent(new Event('eip6963:requestProvider'))

export function wallets() {
  const list = [...found.values()]
  if (!list.length && window.ethereum) list.push({ id: 'injected', name: window.ethereum.isMetaMask ? 'MetaMask' : 'Browser wallet', icon: null, provider: window.ethereum })
  return list
}

export const onWallets = (fn) => (listeners.add(fn), () => listeners.delete(fn))

/// The provider a saved session used, once its wallet has announced itself.
export const providerFor = (id) => found.get(id)?.provider ?? window.ethereum ?? null
