'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import styles from './DatingModule.module.css'

type DatingProfile = {
  id: string
  firstName: string
  lastName: string
  age: number
  bio: string
  photoUrl: string
  contact?: { type: 'instagram' | 'phone'; value: string }
}

type DatingModuleProps = {
  slug: string
  enabled: boolean
}

const tokenKey = (slug: string) => `geteventsnap-dating-session-v2:${slug}`

function createToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readToken(slug: string) {
  const key = tokenKey(slug)
  const existing = window.localStorage.getItem(key)
  if (existing && /^[0-9a-f]{64}$/i.test(existing)) return existing
  const token = createToken()
  window.localStorage.setItem(key, token)
  return token
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

export default function DatingModule({ slug, enabled }: DatingModuleProps) {
  const [token, setToken] = useState('')
  const [active, setActive] = useState(false)
  const [profile, setProfile] = useState<DatingProfile | null>(null)
  const [candidates, setCandidates] = useState<DatingProfile[]>([])
  const [matches, setMatches] = useState<DatingProfile[]>([])
  const [liked, setLiked] = useState<DatingProfile[]>([])
  const [newMatch, setNewMatch] = useState<DatingProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [photoPreview, setPhotoPreview] = useState('')

  const endpoint = useMemo(() => `/api/events/${encodeURIComponent(slug)}/dating`, [slug])

  function formatDisplayName(firstName: string, lastName: string) {
    const trimmedFirst = firstName.trim()
    const trimmedLast = lastName.trim()
    if (!trimmedLast || trimmedLast === trimmedFirst) return trimmedFirst || 'Katılımcı'
    return `${trimmedFirst} ${trimmedLast}`
  }

  const refreshFeed = useCallback(async (sessionToken: string) => {
    const response = await fetch(`${endpoint}/feed`, { headers: auth(sessionToken) })
    const body = await response.json() as { candidates?: DatingProfile[]; matches?: DatingProfile[]; liked?: DatingProfile[]; error?: string }
    if (!response.ok) throw new Error(body.error ?? 'Profiller yüklenemedi.')
    setCandidates(body.candidates ?? [])
    setMatches(body.matches ?? [])
    setLiked(body.liked ?? [])
  }, [endpoint])

  async function removeLike(target: DatingProfile) {
    if (!token || !window.confirm(`${formatDisplayName(target.firstName, target.lastName)} beğenilenlerden kaldırılsın mı?`)) return
    setWorking(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${endpoint}/interactions`, {
        method: 'DELETE',
        headers: { ...auth(token), 'content-type': 'application/json' },
        body: JSON.stringify({ profileId: target.id }),
      })
      const body = await response.json() as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Beğeni silinemedi.')
      setNotice('Beğeni kaldırıldı.')
      await refreshFeed(token)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Beğeni silinemedi.')
    } finally {
      setWorking(false)
    }
  }

  useEffect(() => {
    let mounted = true
    if (!enabled) {
      setLoading(false)
      return
    }

    try {
      const sessionToken = readToken(slug)
      setToken(sessionToken)
      fetch(`${endpoint}/session`, { headers: auth(sessionToken) })
        .then(async (response) => {
          const body = await response.json() as { active?: boolean; profile?: DatingProfile | null; error?: string }
          if (!response.ok) throw new Error(body.error ?? 'Tanışma bilgisi alınamadı.')
          if (!mounted) return
          setActive(body.active === true)
          setProfile(body.profile ?? null)
          if (body.active && body.profile) await refreshFeed(sessionToken)
        })
        .catch((requestError: unknown) => {
          if (mounted) setError(requestError instanceof Error ? requestError.message : 'Tanışma bilgisi alınamadı.')
        })
        .finally(() => {
          if (mounted) setLoading(false)
        })
    } catch {
      setError('Bu telefonda güvenli oturum açılamadı. Tarayıcı ayarlarından site depolamasına izin verin.')
      setLoading(false)
    }

    return () => {
      mounted = false
    }
  }, [enabled, endpoint, refreshFeed, slug])

  useEffect(() => {
    if (!photoPreview) return
    return () => URL.revokeObjectURL(photoPreview)
  }, [photoPreview])

  async function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return
    setWorking(true)
    setError('')
    setNotice('')
    const form = event.currentTarget
    const formData = new FormData(form)
    const nickname = String(formData.get('nickname') ?? '').trim()
    if (!nickname) {
      setError('Takma adınız en az 1 karakter olmalıdır.')
      setWorking(false)
      return
    }
    formData.set('firstName', nickname)
    formData.set('lastName', nickname)

    try {
      const response = await fetch(`${endpoint}/profile`, {
        method: 'POST',
        headers: auth(token),
        body: formData,
      })
      const body = await response.json() as { profile?: DatingProfile; error?: string }
      if (!response.ok || !body.profile) throw new Error(body.error ?? 'Profil oluşturulamadı.')
      setProfile(body.profile)
      setNotice('Profiliniz hazır. Dilerseniz etkinlikteki profillere göz atın.')
      await refreshFeed(token)
      form.reset()
      setPhotoPreview('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Profil oluşturulamadı.')
    } finally {
      setWorking(false)
    }
  }

  async function chooseProfile(candidate: DatingProfile, action: 'like' | 'pass') {
    if (!token) return
    setWorking(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${endpoint}/interactions`, {
        method: 'POST',
        headers: { ...auth(token), 'content-type': 'application/json' },
        body: JSON.stringify({ profileId: candidate.id, action }),
      })
      const body = await response.json() as { matched?: boolean; match?: DatingProfile; error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Seçiminiz kaydedilemedi.')
      if (body.matched && body.match) {
        setNewMatch(body.match)
        setMatches((current) => [body.match as DatingProfile, ...current.filter((item) => item.id !== body.match?.id)])
      }
      await refreshFeed(token)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Seçiminiz kaydedilemedi.')
    } finally {
      setWorking(false)
    }
  }

  async function protectProfile(candidate: DatingProfile, action: 'report' | 'block') {
    if (!token) return
    const reason = action === 'report' ? window.prompt('Neden bildirmek istiyorsunuz? (En az 3 karakter)') : ''
    if (action === 'report' && !reason) return
    setWorking(true)
    setError('')
    try {
      const response = await fetch(`${endpoint}/safety`, {
        method: 'POST',
        headers: { ...auth(token), 'content-type': 'application/json' },
        body: JSON.stringify({ profileId: candidate.id, action, reason }),
      })
      const body = await response.json() as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Güvenlik işlemi tamamlanamadı.')
      setNotice(action === 'block' ? 'Profil engellendi ve bu telefonda yeniden gösterilmeyecek.' : 'Bildiriminiz etkinlik sahibine iletildi.')
      if (action === 'block') await refreshFeed(token)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Güvenlik işlemi tamamlanamadı.')
    } finally {
      setWorking(false)
    }
  }

  async function removeOwnProfile() {
    if (!token || !window.confirm('Profiliniz, fotoğrafınız ve tüm eşleşmeleriniz silinsin mi? Bu işlem geri alınamaz.')) return
    setWorking(true)
    setError('')
    try {
      const response = await fetch(`${endpoint}/safety`, { method: 'DELETE', headers: auth(token) })
      const body = await response.json() as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Profil silinemedi.')
      window.localStorage.removeItem(tokenKey(slug))
      const nextToken = readToken(slug)
      setToken(nextToken)
      setProfile(null)
      setCandidates([])
      setMatches([])
      setLiked([])
      setNewMatch(null)
      setNotice('Profiliniz ve ona bağlı veriler silindi.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Profil silinemedi.')
    } finally {
      setWorking(false)
    }
  }

  if (!enabled) return null

  return (
    <section className={styles.module} aria-labelledby="dating-title">
      <div className={styles.heading}>
        <span className={styles.heart} aria-hidden="true">♡</span>
        <div>
          <p className={styles.eyebrow}>İSTEĞE BAĞLI</p>
          <h2 id="dating-title">Tanışma</h2>
        </div>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!active && !loading ? (
        <p className={styles.info}>Tanışma bölümü yalnızca etkinlik günü, saat 00.00–23.59 arasında kullanılabilir. Etkinlik günü geldiğinde burada açılacaktır.</p>
      ) : loading ? (
        <p className={styles.info} role="status">Tanışma bölümü hazırlanıyor…</p>
      ) : (
        <>
          <p className={styles.info}>Yeni insanlarla tanışmak isterseniz profilinizi oluşturun. Takma adınız, yaşınız ve profil fotoğrafınızla katılabilirsiniz; profil verileri etkinlik gününün sonunda silinir.</p>
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          {!profile ? (
            <form className={styles.profileForm} onSubmit={createProfile}>
              <h3>Profilinizi oluşturun</h3>
              <div className={styles.formGrid}>
                <label>Takma adınız <span>(görüntülenecek ad)</span><input name="nickname" autoComplete="nickname" maxLength={30} placeholder="Örn: AşkMühendis" required /></label>
              </div>
              <label className={styles.fileLabel}>
                Profil fotoğrafı
                <input
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="user"
                  required
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    setPhotoPreview(file ? URL.createObjectURL(file) : '')
                  }}
                />
                <span>Fotoğraf çekmek veya galeriden seçmek için dokunun (en fazla 5 MB).</span>
              </label>
              {photoPreview && <img className={styles.preview} src={photoPreview} alt="Seçtiğiniz profil fotoğrafı önizlemesi" />}
              <label>Yaşınız<input name="age" type="number" min={18} max={120} required /></label>
              <label>Kendinizden kısaca bahsedin <span>(isteğe bağlı, en fazla 240 karakter)</span><textarea name="bio" maxLength={240} rows={3} /></label>
              <fieldset className={styles.contact}>
                <legend>İletişim bilginiz <span>(isteğe bağlı, yalnızca eşleşince görünür)</span></legend>
                <label>Tür
                  <select name="contactType" defaultValue="">
                    <option value="">Paylaşmak istemiyorum</option>
                    <option value="instagram">Instagram kullanıcı adı</option>
                    <option value="phone">Telefon numarası</option>
                  </select>
                </label>
                <label>Kullanıcı adı veya telefon
                  <input name="contactValue" maxLength={80} placeholder="İsteğe bağlı" />
                </label>
              </fieldset>
              <label className={styles.consent}>
                <input name="consent" type="checkbox" value="true" required />
                <span>18 yaşında veya daha büyük olduğumu, profil bilgilerimin bu etkinlikte Tanışma’ya katılan diğer kişilere gösterilmesine ve etkinlik günü sonunda silinmesine açık rıza veriyorum. Profilimi istediğim zaman silebilirim.</span>
              </label>
              <button className={styles.primary} type="submit" disabled={working}>
                {working ? 'Profil oluşturuluyor…' : 'Profilimi oluştur'}
              </button>
            </form>
          ) : (
            <div className={styles.discover}>
              <div className={styles.selfProfile}>
                <img src={profile.photoUrl} alt={formatDisplayName(profile.firstName, profile.lastName)} />
                <div>
                  <strong>{formatDisplayName(profile.firstName, profile.lastName)}, {profile.age}</strong>
                  <span>Profiliniz etkinlik günü sonunda silinir.</span>
                </div>
                <button type="button" className={styles.textButton} onClick={removeOwnProfile} disabled={working}>Profilimi sil</button>
              </div>
              {newMatch && (
                <div className={styles.matchNotice} role="status">
                  <strong>♡ Eşleştiniz!</strong>
                  <span>{newMatch.firstName} ile birbirinizi beğendiniz.</span>
                  {newMatch.contact && <span>{newMatch.contact.type === 'instagram' ? 'Instagram' : 'Telefon'}: {newMatch.contact.value}</span>}
                  <button type="button" className={styles.textButton} onClick={() => setNewMatch(null)}>Kapat</button>
                </div>
              )}
              <div className={styles.listHeading}>
                <h3>Etkinlikteki kişiler</h3>
                <button type="button" className={styles.textButton} onClick={() => refreshFeed(token).catch((refreshError: unknown) => setError(refreshError instanceof Error ? refreshError.message : 'Yenilenemedi.'))} disabled={working}>Yenile</button>
              </div>
              {candidates[0] ? (
                <article className={styles.person}>
                  <img className={styles.personPhoto} src={candidates[0].photoUrl} alt={`${formatDisplayName(candidates[0].firstName, candidates[0].lastName)} adlı kişinin profil fotoğrafı`} />
                  <div className={styles.personDetails}>
                    <h4>{formatDisplayName(candidates[0].firstName, candidates[0].lastName)}, {candidates[0].age}</h4>
                    <p>{candidates[0].bio || 'Henüz kendisi hakkında bilgi eklemedi.'}</p>
                  </div>
                  <div className={styles.actions}>
                    <button type="button" className={styles.pass} onClick={() => chooseProfile(candidates[0], 'pass')} disabled={working}>Geç</button>
                    <button type="button" className={styles.like} onClick={() => chooseProfile(candidates[0], 'like')} disabled={working}>♡ Beğen</button>
                  </div>
                  <div className={styles.safety}>
                    <button type="button" className={styles.textButton} onClick={() => protectProfile(candidates[0], 'report')} disabled={working}>Bildir</button>
                    <button type="button" className={styles.textButton} onClick={() => protectProfile(candidates[0], 'block')} disabled={working}>Engelle</button>
                  </div>
                </article>
              ) : (
                <p className={styles.info}>Şu an gösterilecek yeni profil yok. Dilerseniz biraz sonra “Yenile” düğmesine basın.</p>
              )}
              {liked.length > 0 && (
                <section className={styles.matches} aria-labelledby="liked-title">
                  <h3 id="liked-title">Beğendiklerim</h3>
                  {liked.map((person) => (
                    <div className={styles.matchRow} key={person.id}>
                      <img src={person.photoUrl} alt="" />
                      <div>
                        <strong>{formatDisplayName(person.firstName, person.lastName)}, {person.age}</strong>
                        <span>{person.contact ? 'Eşleştiniz' : 'Henüz karşılık vermedi'}</span>
                      </div>
                      <button type="button" className={styles.textButton} onClick={() => removeLike(person)} disabled={working}>Sil</button>
                    </div>
                  ))}
                </section>
              )}
              {matches.length > 0 && (
                <section className={styles.matches} aria-labelledby="matches-title">
                  <h3 id="matches-title">Eşleşmeleriniz</h3>
                  {matches.map((match) => (
                    <div className={styles.matchRow} key={match.id}>
                      <img src={match.photoUrl} alt="" />
                      <div>
                        <strong>{match.firstName} {match.lastName}</strong>
                        {match.contact
                          ? <span>{match.contact.type === 'instagram' ? 'Instagram' : 'Telefon'}: {match.contact.value}</span>
                          : <span>İletişim bilgisi paylaşılmadı.</span>}
                      </div>
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
