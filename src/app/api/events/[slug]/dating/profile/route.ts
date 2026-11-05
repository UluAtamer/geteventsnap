import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  createDatingAdminClient,
  getDatingEvent,
  getGuestProfile,
  getGuestToken,
  getSignedPhotoUrl,
  isDatingEventActive,
  publicProfile,
} from '@/lib/dating-server'

type RouteContext = { params: Promise<{ slug: string }> }

function imageMatchesType(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mimeType === 'image/png') {
    return bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
  }
  if (mimeType === 'image/webp') {
    return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  }
  return false
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { slug } = await params
    const event = await getDatingEvent(slug)
    if (!event) return NextResponse.json({ error: 'Etkinlik bulunamadı.' }, { status: 404 })
    if (!isDatingEventActive(event)) {
      return NextResponse.json({ error: 'Tanışma yalnızca etkinlik günü kullanılabilir.' }, { status: 403 })
    }

    const token = getGuestToken(request)
    if (!token) return NextResponse.json({ error: 'Misafir oturumu oluşturulamadı.' }, { status: 401 })
    if (await getGuestProfile(event.id, token)) {
      return NextResponse.json({ error: 'Bu telefonda zaten bir Tanışma profili var.' }, { status: 409 })
    }

    const form = await request.formData()
    const firstName = String(form.get('firstName') ?? '').trim()
    const lastName = String(form.get('lastName') ?? '').trim()
    const age = Number(form.get('age'))
    const bio = String(form.get('bio') ?? '').trim()
    const consent = form.get('consent') === 'true'
    const contactTypeValue = String(form.get('contactType') ?? '')
    const contactValueInput = String(form.get('contactValue') ?? '').trim()
    const contactType = contactValueInput ? contactTypeValue : null
    const photo = form.get('photo')

    if (firstName.length < 1 || firstName.length > 40 || lastName.length < 1 || lastName.length > 40) {
      return NextResponse.json({ error: 'Ad ve soyad 1–40 karakter olmalıdır.' }, { status: 400 })
    }
    if (!Number.isInteger(age) || age < 18 || age > 120) {
      return NextResponse.json({ error: 'Tanışma profili oluşturmak için 18 yaşında veya daha büyük olmalısınız.' }, { status: 400 })
    }
    if (bio.length > 240) return NextResponse.json({ error: 'Kısa tanıtım en fazla 240 karakter olabilir.' }, { status: 400 })
    if (!consent) return NextResponse.json({ error: 'Açık rıza onayı verilmeden profil oluşturulamaz.' }, { status: 400 })
    if (contactValueInput && !['instagram', 'phone'].includes(contactTypeValue)) {
      return NextResponse.json({ error: 'İletişim türü geçerli değil.' }, { status: 400 })
    }
    if (contactType === 'instagram' &&
      !/^@?[A-Za-z0-9._]{1,30}$/.test(contactValueInput)) {
      return NextResponse.json({ error: 'Instagram kullanıcı adını kontrol edin.' }, { status: 400 })
    }
    if (contactType === 'phone' &&
      (!/^[+()\d\s.-]{7,24}$/.test(contactValueInput) || contactValueInput.replace(/\D/g, '').length < 7)) {
      return NextResponse.json({ error: 'Telefon numarasını kontrol edin.' }, { status: 400 })
    }
    if (!(photo instanceof File) || photo.size < 1 || photo.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: '5 MB veya daha küçük bir profil fotoğrafı seçin.' }, { status: 400 })
    }

    const bytes = new Uint8Array(await photo.arrayBuffer())
    if (!imageMatchesType(bytes, photo.type)) {
      return NextResponse.json({ error: 'Fotoğraf JPEG, PNG veya WebP biçiminde olmalıdır.' }, { status: 400 })
    }

    const admin = createDatingAdminClient()
    const profileId = randomUUID()
    const extension = photo.type === 'image/jpeg' ? 'jpg' : photo.type === 'image/png' ? 'png' : 'webp'
    const photoPath = `${event.id}/${profileId}.${extension}`
    const { error: uploadError } = await admin.storage
      .from('dating-photos')
      .upload(photoPath, bytes, { contentType: photo.type, upsert: false })

    if (uploadError) {
      console.error('Tanışma profil fotoğrafı kaydedilemedi:', uploadError)
      return NextResponse.json({ error: 'Fotoğraf yüklenemedi. İnternet bağlantısını kontrol edip tekrar deneyin.' }, { status: 502 })
    }

    const { data: profile, error: insertError } = await admin
      .from('guest_profiles')
      .insert({
        id: profileId,
        event_id: event.id,
        guest_token_hash: createHash('sha256').update(token).digest('hex'),
        first_name: firstName,
        last_name: lastName,
        age,
        photo_path: photoPath,
        bio,
        contact_type: contactType,
        contact_value: contactValueInput || null,
        consented_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (insertError || !profile) {
      const permissionDenied = insertError && typeof insertError === 'object' && 'code' in insertError && insertError.code === '42501'
      console.error('Tanışma profili kaydedilemedi:', insertError)
      const { error: cleanupError } = await admin.storage.from('dating-photos').remove([photoPath])
      if (cleanupError) console.error('Kullanılmayan Tanışma fotoğrafı temizlenemedi:', cleanupError)
      if (permissionDenied) {
        return NextResponse.json({ error: 'Supabase veritabanı izni eksik. Lütfen guest_profiles tablosuna service_role grant ekleyin.' }, { status: 503 })
      }
      return NextResponse.json({ error: 'Profil oluşturulamadı. Lütfen tekrar deneyin.' }, { status: 500 })
    }

    return NextResponse.json({
      profile: publicProfile(profile, await getSignedPhotoUrl(photoPath)),
    }, { status: 201 })
  } catch (error) {
    console.error('Tanışma profili oluşturulamadı:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Profil oluşturulamadı.' },
      { status: 500 },
    )
  }
}
