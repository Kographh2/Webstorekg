'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ImagePlus, Loader2, Megaphone, ExternalLink, Package } from 'lucide-react'
import { useAuth } from '@/components/auth-provider'
import { supabase } from '@/lib/supabase'
import { Ad, Product } from '@/types'
import toast from 'react-hot-toast'

const AD_DURATION_PRICES = [
  { days: 7, price: 50000, label: '7 hari' },
  { days: 14, price: 90000, label: '14 hari' },
  { days: 30, price: 150000, label: '30 hari' },
]

export default function SellerAdsPage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const [shop, setShop] = useState<any>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [ads, setAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    productId: '',
    targetUrl: '',
    imageUrl: '',
    title: '',
    description: '',
    durationDays: 7,
  })

  useEffect(() => {
    if (!user) {
      router.push('/')
      return
    }
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const loadData = async () => {
    try {
      const { data: shopData } = await (supabase as any).from('shops').select('*').eq('owner_id', user!.id).single()
      if (!shopData) {
        toast.error('Anda belum memiliki toko')
        router.push('/')
        return
      }
      setShop(shopData)

      const { data: productsData } = await (supabase as any)
        .from('products')
        .select('*')
        .eq('shop_id', shopData.id)
        .eq('is_active', true)

      setProducts((productsData as Product[]) || [])

      const { data: adsData } = await (supabase as any)
        .from('ads')
        .select('*')
        .eq('shop_id', shopData.id)
        .order('created_at', { ascending: false })

      setAds((adsData as Ad[]) || [])
    } catch (error) {
      console.error('Error loading ads data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    if (file.size > 3 * 1024 * 1024) {
      toast.error('Ukuran gambar maksimal 3MB')
      return
    }
    setUploadingImage(true)
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${user.id}/ad-${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('ad-images').upload(path, file, { upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('ad-images').getPublicUrl(path)
      setForm((f) => ({ ...f, imageUrl: data.publicUrl }))
      toast.success('Gambar berhasil diunggah')
    } catch (error) {
      console.error('Error uploading ad image:', error)
      toast.error('Gagal mengunggah gambar')
    } finally {
      setUploadingImage(false)
    }
  }

  const handleProductSelect = (productId: string) => {
    const product = products.find((p) => p.id === productId)
    setForm((f) => ({
      ...f,
      productId,
      targetUrl: product ? `${window.location.origin}/product/${product.id}` : f.targetUrl,
      title: product ? f.title || product.name : f.title,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!shop) return

    if (!form.targetUrl.trim() || !form.imageUrl || !form.title.trim() || !form.description.trim()) {
      toast.error('Lengkapi semua field yang wajib diisi')
      return
    }

    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const selectedDuration = AD_DURATION_PRICES.find((d) => d.days === form.durationDays)

      const response = await fetch('/api/ads/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({
          shopId: shop.id,
          productId: form.productId || null,
          targetUrl: form.targetUrl.trim(),
          imageUrl: form.imageUrl,
          title: form.title.trim(),
          description: form.description.trim(),
          pricePaid: selectedDuration?.price || 0,
          durationDays: form.durationDays,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)

      toast.success(result.message)
      setForm({ productId: '', targetUrl: '', imageUrl: '', title: '', description: '', durationDays: 7 })
      loadData()
    } catch (error: any) {
      toast.error(error.message || 'Gagal mengajukan iklan')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="text-xl font-bold text-gray-900">Beli Iklan</h1>
        </div>

        {/* Submission form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center">
              <Megaphone size={20} />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Ajukan Iklan Baru</h2>
              <p className="text-xs text-gray-500">Akan ditinjau tim kami dalam 24 jam</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {products.length > 0 && (
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1.5 block">Pilih Produk (opsional)</label>
                <select
                  className="input-field"
                  value={form.productId}
                  onChange={(e) => handleProductSelect(e.target.value)}
                >
                  <option value="">Link kustom (isi manual di bawah)</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">Link Tujuan (saat iklan diklik)</label>
              <input
                type="url"
                className="input-field"
                placeholder="https://..."
                value={form.targetUrl}
                onChange={(e) => setForm((f) => ({ ...f, targetUrl: e.target.value }))}
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">Gambar Iklan</label>
              {form.imageUrl ? (
                <div className="relative w-full h-40 rounded-xl overflow-hidden border border-gray-200">
                  <img src={form.imageUrl} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, imageUrl: '' }))}
                    className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-lg"
                  >
                    Hapus
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage}
                  className="w-full h-32 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-primary-300 hover:text-primary-500 transition-colors disabled:opacity-50"
                >
                  {uploadingImage ? <Loader2 size={22} className="animate-spin" /> : <ImagePlus size={22} />}
                  <span className="text-xs">{uploadingImage ? 'Mengunggah...' : 'Unggah gambar iklan'}</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">Judul Iklan</label>
              <input
                className="input-field"
                placeholder="Contoh: Diskon 50% Hari Ini!"
                maxLength={100}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">Deskripsi</label>
              <textarea
                className="input-field min-h-24"
                placeholder="Deskripsikan iklan Anda..."
                maxLength={500}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">Durasi Tayang</label>
              <div className="grid grid-cols-3 gap-2">
                {AD_DURATION_PRICES.map((d) => (
                  <button
                    key={d.days}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, durationDays: d.days }))}
                    className={`rounded-xl border p-3 text-center transition-colors ${
                      form.durationDays === d.days ? 'border-primary-600 bg-primary-50' : 'border-gray-200'
                    }`}
                  >
                    <p className="text-sm font-bold text-gray-900">{d.label}</p>
                    <p className="text-xs text-gray-500">Rp{d.price.toLocaleString('id-ID')}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
              Iklan untuk konten judi online, penipuan, atau hal negatif lainnya akan ditolak dan toko Anda berisiko di-banned.
            </div>

            <button type="submit" disabled={submitting} className="btn-primary w-full disabled:opacity-60">
              {submitting ? 'Mengajukan...' : `Ajukan Iklan (Rp${(AD_DURATION_PRICES.find((d) => d.days === form.durationDays)?.price || 0).toLocaleString('id-ID')})`}
            </button>
          </form>
        </div>

        {/* Past submissions */}
        <h2 className="font-bold text-gray-900 mb-3">Riwayat Pengajuan</h2>
        {ads.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
            <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Belum ada pengajuan iklan</p>
          </div>
        ) : (
          <div className="space-y-3">
            {ads.map((ad) => (
              <div key={ad.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex gap-3">
                <img src={ad.image_url} alt={ad.title} className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm text-gray-900 truncate">{ad.title}</p>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                      ad.status === 'approved' ? 'bg-green-100 text-green-700' :
                      ad.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      ad.status === 'expired' ? 'bg-gray-100 text-gray-600' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {ad.status === 'pending' ? 'Ditinjau' : ad.status === 'approved' ? 'Aktif' : ad.status === 'rejected' ? 'Ditolak' : 'Berakhir'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{new Date(ad.created_at).toLocaleDateString('id-ID')}</p>
                  {ad.status === 'rejected' && ad.rejection_reason && (
                    <p className="text-xs text-red-600 mt-1">{ad.rejection_reason}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
