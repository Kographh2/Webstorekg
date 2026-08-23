'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import {
  Users, DollarSign, TrendingUp, ShoppingBag, Shield,
  Plus, Settings, BarChart3, AlertTriangle, Store, Package,
  Mail, Ban, Megaphone, ImagePlus, Loader2, CheckCircle2, XCircle, ExternalLink,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth-provider'
import { Profile, Withdrawal, Shop, Ad } from '@/types'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'

type BanTarget = { type: 'user' | 'shop'; id: string; name: string } | null

const BAN_DURATION_PRESETS = [
  { label: '1 Hari', days: 1 },
  { label: '3 Hari', days: 3 },
  { label: '7 Hari', days: 7 },
  { label: '30 Hari', days: 30 },
  { label: 'Permanen', days: null },
]

const BROADCAST_TYPES: Array<{ value: 'normal' | 'ads' | 'maintenance' | 'repair' | 'promo'; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'promo', label: 'Promo' },
  { value: 'ads', label: 'Iklan' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'repair', label: 'Perbaikan' },
]

export default function OwnerDashboard() {
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalSellers: 0,
    totalShops: 0,
    totalProducts: 0,
    totalOrders: 0,
    totalRevenue: 0,
    pendingWithdrawals: 0,
    pendingAds: 0,
  })
  const [users, setUsers] = useState<Profile[]>([])
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [shops, setShops] = useState<Shop[]>([])
  const [ads, setAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'shops' | 'withdrawals' | 'broadcast' | 'ads'>('overview')
  const [broadcast, setBroadcast] = useState({ subject: '', body: '', type: 'normal' as typeof BROADCAST_TYPES[number]['value'] })
  const [broadcastImageUrl, setBroadcastImageUrl] = useState<string | null>(null)
  const [uploadingBroadcastImage, setUploadingBroadcastImage] = useState(false)
  const [sendingBroadcast, setSendingBroadcast] = useState(false)
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [verifyingShopId, setVerifyingShopId] = useState<string | null>(null)
  const [banTarget, setBanTarget] = useState<BanTarget>(null)
  const [banDurationDays, setBanDurationDays] = useState<number | null>(7)
  const [banReason, setBanReason] = useState('')
  const [submittingBan, setSubmittingBan] = useState(false)
  const [reviewingAdId, setReviewingAdId] = useState<string | null>(null)
  const [rejectReasonFor, setRejectReasonFor] = useState<string | null>(null)
  const [rejectReasonText, setRejectReasonText] = useState('')
  const broadcastImageInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const { user, profile } = useAuth()

  useEffect(() => {
    if (!user || !profile || (profile.role !== 'owner' && profile.role !== 'admin')) {
      router.push('/')
      return
    }
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile, router])

  const loadData = async () => {
    try {
      const [usersRes, sellersRes, shopsRes, productsRes, ordersRes, withdrawalsRes, adsRes] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact' }),
        supabase.from('profiles').select('*', { count: 'exact' }).eq('role', 'seller'),
        supabase.from('shops').select('*'),
        supabase.from('products').select('*', { count: 'exact' }),
        supabase.from('orders').select('total_amount', { count: 'exact' }),
        supabase.from('withdrawals').select('*').eq('status', 'pending'),
        (supabase as any).from('ads_admin_view').select('*').order('created_at', { ascending: false }),
      ])

      setStats({
        totalUsers: usersRes.count || 0,
        totalSellers: sellersRes.count || 0,
        totalShops: shopsRes.count || 0,
        totalProducts: productsRes.count || 0,
        totalOrders: ordersRes.count || 0,
        totalRevenue: (ordersRes.data as any[])?.reduce((sum, order) => sum + order.total_amount, 0) || 0,
        pendingWithdrawals: (withdrawalsRes.data as any[])?.length || 0,
        pendingAds: ((adsRes.data as Ad[]) || []).filter((a) => a.status === 'pending').length,
      })

      if (usersRes.data) setUsers(usersRes.data as Profile[])
      if (withdrawalsRes.data) setWithdrawals(withdrawalsRes.data as Withdrawal[])
      if (shopsRes.data) setShops(shopsRes.data as Shop[])
      if (adsRes.data) setAds(adsRes.data as Ad[])
    } catch (error) {
      console.error('Error loading owner data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleApproveWithdrawal = async (id: string) => {
    try {
      const { error } = await (supabase as any)
        .from('withdrawals')
        .update({ status: 'approved', processed_by: user?.id, processed_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      toast.success('Withdrawal berhasil disetujui')
      loadData()
    } catch (error) {
      console.error('Error approving withdrawal:', error)
      toast.error('Gagal menyetujui withdrawal')
    }
  }

  const handleRejectWithdrawal = async (id: string) => {
    try {
      const { error } = await (supabase as any)
        .from('withdrawals')
        .update({ status: 'rejected', processed_by: user?.id, processed_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      toast.success('Withdrawal berhasil ditolak')
      loadData()
    } catch (error) {
      console.error('Error rejecting withdrawal:', error)
      toast.error('Gagal menolak withdrawal')
    }
  }

  const handleUpdateUserRole = async (userId: string, newRole: string) => {
    try {
      const { error } = await (supabase as any).from('profiles').update({ role: newRole }).eq('id', userId)
      if (error) throw error
      toast.success('Role user berhasil diubah')
      loadData()
      setEditingUser(null)
    } catch (error) {
      console.error('Error updating user role:', error)
      toast.error('Gagal mengubah role user')
    }
  }

  const handleToggleShopVerification = async (shop: Shop) => {
    setVerifyingShopId(shop.id)
    try {
      const nextVerified = !shop.is_verified
      const { error } = await (supabase as any)
        .from('shops')
        .update({ is_verified: nextVerified, auto_verified: nextVerified ? shop.auto_verified : false })
        .eq('id', shop.id)
      if (error) throw error
      toast.success(nextVerified ? 'Toko berhasil diverifikasi' : 'Verifikasi toko dibatalkan')
      setShops((prev) => prev.map((s) => (s.id === shop.id ? { ...s, is_verified: nextVerified, auto_verified: nextVerified ? s.auto_verified : false } : s)))
    } catch (error) {
      console.error('Error toggling shop verification:', error)
      toast.error('Gagal mengubah status verifikasi toko')
    } finally {
      setVerifyingShopId(null)
    }
  }

  // ── Ban system ──────────────────────────────────────────────────
  const openBanModal = (type: 'user' | 'shop', id: string, name: string) => {
    setBanTarget({ type, id, name })
    setBanDurationDays(7)
    setBanReason('')
  }

  const handleConfirmBan = async () => {
    if (!banTarget) return
    if (!banReason.trim()) {
      toast.error('Alasan banned wajib diisi')
      return
    }
    setSubmittingBan(true)
    try {
      const until = banDurationDays === null ? new Date('2099-12-31').toISOString() : new Date(Date.now() + banDurationDays * 86400000).toISOString()
      const rpcName = banTarget.type === 'user' ? 'owner_set_user_ban' : 'owner_set_shop_ban'
      const paramKey = banTarget.type === 'user' ? 'p_user_id' : 'p_shop_id'
      const { error } = await supabase.rpc(rpcName, { [paramKey]: banTarget.id, p_until: until, p_reason: banReason.trim() } as any)
      if (error) throw error
      toast.success(`${banTarget.type === 'user' ? 'User' : 'Toko'} "${banTarget.name}" berhasil di-banned`)
      setBanTarget(null)
      loadData()
    } catch (error) {
      console.error('Error banning:', error)
      toast.error('Gagal memproses banned')
    } finally {
      setSubmittingBan(false)
    }
  }

  const handleUnban = async (type: 'user' | 'shop', id: string, name: string) => {
    try {
      const rpcName = type === 'user' ? 'owner_set_user_ban' : 'owner_set_shop_ban'
      const paramKey = type === 'user' ? 'p_user_id' : 'p_shop_id'
      const { error } = await supabase.rpc(rpcName, { [paramKey]: id, p_until: null, p_reason: null } as any)
      if (error) throw error
      toast.success(`Banned "${name}" dicabut`)
      loadData()
    } catch (error) {
      console.error('Error unbanning:', error)
      toast.error('Gagal mencabut banned')
    }
  }

  const isBanned = (bannedUntil?: string | null) => !!bannedUntil && new Date(bannedUntil) > new Date()

  // ── Broadcast ───────────────────────────────────────────────────
  const handleBroadcastImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    if (file.size > 3 * 1024 * 1024) {
      toast.error('Ukuran gambar maksimal 3MB')
      return
    }
    setUploadingBroadcastImage(true)
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${user.id}/broadcast-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('broadcast-images').upload(path, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data } = supabase.storage.from('broadcast-images').getPublicUrl(path)
      setBroadcastImageUrl(data.publicUrl)
      toast.success('Gambar berhasil diunggah')
    } catch (error) {
      console.error('Error uploading broadcast image:', error)
      toast.error('Gagal mengunggah gambar')
    } finally {
      setUploadingBroadcastImage(false)
    }
  }

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault()
    if (profile?.role !== 'owner') return toast.error('Broadcast hanya dapat dikirim oleh owner')
    setSendingBroadcast(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch('/api/owner/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ subject: broadcast.subject, body: broadcast.body, imageUrl: broadcastImageUrl, broadcastType: broadcast.type }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      toast.success(`Broadcast dikirim ke ${result.sent} email + notifikasi dalam-aplikasi ke semua pengguna`)
      setBroadcast({ subject: '', body: '', type: 'normal' })
      setBroadcastImageUrl(null)
    } catch (error: any) {
      toast.error(error.message || 'Gagal mengirim broadcast')
    } finally {
      setSendingBroadcast(false)
    }
  }

  // ── Ads review ──────────────────────────────────────────────────
  const handleApproveAd = async (adId: string) => {
    setReviewingAdId(adId)
    try {
      const { error } = await (supabase as any).rpc('owner_review_ad', { p_ad_id: adId, p_decision: 'approved', p_rejection_reason: null, p_duration_days: 7 })
      if (error) throw error
      toast.success('Iklan disetujui')
      loadData()
    } catch (error) {
      console.error('Error approving ad:', error)
      toast.error('Gagal menyetujui iklan')
    } finally {
      setReviewingAdId(null)
    }
  }

  const handleRejectAd = async (adId: string) => {
    if (!rejectReasonText.trim()) {
      toast.error('Alasan penolakan wajib diisi')
      return
    }
    setReviewingAdId(adId)
    try {
      const { error } = await (supabase as any).rpc('owner_review_ad', { p_ad_id: adId, p_decision: 'rejected', p_rejection_reason: rejectReasonText.trim(), p_duration_days: 7 })
      if (error) throw error
      toast.success('Iklan ditolak')
      setRejectReasonFor(null)
      setRejectReasonText('')
      loadData()
    } catch (error) {
      console.error('Error rejecting ad:', error)
      toast.error('Gagal menolak iklan')
    } finally {
      setReviewingAdId(null)
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
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard Owner</h1>
            <p className="text-gray-600">Kelola seluruh platform Kograph Store</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => router.push('/settings')} className="btn-secondary flex items-center gap-2">
              <Settings size={18} /> Pengaturan
            </button>
            <button onClick={() => router.push('/settings?tab=add-seller')} className="btn-primary flex items-center gap-2">
              <Plus size={18} /> Tambah Seller
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 border-b border-gray-200 mb-8 overflow-x-auto">
          {[
            { id: 'overview', label: 'Ringkasan', icon: BarChart3 },
            { id: 'users', label: 'Pengguna', icon: Users, count: stats.totalUsers },
            { id: 'shops', label: 'Toko', icon: Store, count: stats.totalShops },
            { id: 'withdrawals', label: 'Pencairan', icon: DollarSign, badge: stats.pendingWithdrawals },
            { id: 'ads', label: 'Iklan', icon: Megaphone, badge: stats.pendingAds },
            ...(profile?.role === 'owner' ? [{ id: 'broadcast', label: 'Broadcast', icon: Mail }] : []),
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 pb-4 text-sm font-medium transition-colors relative whitespace-nowrap ${
                activeTab === tab.id ? 'text-primary-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
              {tab.count !== undefined && (
                <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{tab.count}</span>
              )}
              {!!tab.badge && tab.badge > 0 && (
                <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{tab.badge}</span>
              )}
              {activeTab === tab.id && (
                <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600" />
              )}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Pengguna', value: stats.totalUsers, icon: Users, color: 'bg-blue-500' },
                { label: 'Total Seller', value: stats.totalSellers, icon: ShoppingBag, color: 'bg-green-500' },
                { label: 'Total Toko', value: stats.totalShops, icon: Store, color: 'bg-purple-500' },
                { label: 'Total Produk', value: stats.totalProducts, icon: Package, color: 'bg-orange-500' },
                { label: 'Total Pesanan', value: stats.totalOrders, icon: TrendingUp, color: 'bg-pink-500' },
                { label: 'Total Pendapatan', value: formatCurrency(stats.totalRevenue), icon: DollarSign, color: 'bg-yellow-500' },
                { label: 'Pencairan Pending', value: stats.pendingWithdrawals, icon: AlertTriangle, color: 'bg-red-500' },
                { label: 'Iklan Pending', value: stats.pendingAds, icon: Megaphone, color: 'bg-indigo-500' },
              ].map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100"
                >
                  <div className={`w-10 h-10 ${stat.color} rounded-xl flex items-center justify-center mb-3`}>
                    <stat.icon size={20} className="text-white" />
                  </div>
                  <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                  <p className="text-sm text-gray-600">{stat.label}</p>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
                    <th className="pb-3 pl-6 font-medium">User</th>
                    <th className="pb-3 font-medium">Email</th>
                    <th className="pb-3 font-medium">Role</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Terdaftar</th>
                    <th className="pb-3 pr-6 font-medium text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const banned = isBanned(u.banned_until)
                    return (
                      <tr key={u.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="py-4 pl-6">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-medium text-sm">
                              {u.full_name?.[0]?.toUpperCase() || 'U'}
                            </div>
                            <span className="font-medium text-sm">{u.full_name}</span>
                          </div>
                        </td>
                        <td className="py-4 text-sm text-gray-600">{u.email}</td>
                        <td className="py-4">
                          {editingUser === u.id ? (
                            <select
                              value={u.role}
                              onChange={(e) => handleUpdateUserRole(u.id, e.target.value)}
                              onBlur={() => setEditingUser(null)}
                              className="text-xs px-2 py-1 rounded-lg border border-gray-200"
                              autoFocus
                            >
                              <option value="customer">Customer</option>
                              <option value="seller">Seller</option>
                              <option value="admin">Admin</option>
                              <option value="owner">Owner</option>
                            </select>
                          ) : (
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              u.role === 'owner' ? 'bg-red-100 text-red-700' :
                              u.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                              u.role === 'seller' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {u.role}
                            </span>
                          )}
                        </td>
                        <td className="py-4">
                          {banned ? (
                            <span className="text-red-600 flex items-center gap-1 text-sm" title={u.ban_reason || ''}>
                              <Ban size={14} /> Banned s/d {new Date(u.banned_until as string).toLocaleDateString('id-ID')}
                            </span>
                          ) : u.is_verified ? (
                            <span className="text-green-600 flex items-center gap-1 text-sm">
                              <Shield size={14} /> Terverifikasi
                            </span>
                          ) : (
                            <span className="text-gray-500 text-sm">Belum terverifikasi</span>
                          )}
                        </td>
                        <td className="py-4 text-sm text-gray-600">{new Date(u.created_at).toLocaleDateString('id-ID')}</td>
                        <td className="py-4 pr-6 text-right">
                          <div className="flex justify-end gap-3">
                            <button onClick={() => setEditingUser(u.id)} className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                              Kelola
                            </button>
                            {banned ? (
                              <button onClick={() => handleUnban('user', u.id, u.full_name)} className="text-sm text-green-600 hover:text-green-700 font-medium">
                                Cabut Banned
                              </button>
                            ) : (
                              <button onClick={() => openBanModal('user', u.id, u.full_name)} className="text-sm text-red-600 hover:text-red-700 font-medium">
                                Banned
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'shops' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
                    <th className="pb-3 pl-6 font-medium">Toko</th>
                    <th className="pb-3 font-medium">Owner</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Rating</th>
                    <th className="pb-3 font-medium">Terjual</th>
                    <th className="pb-3 font-medium">Dibuat</th>
                    <th className="pb-3 pr-6 font-medium text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {shops.map((shop) => {
                    const banned = isBanned(shop.banned_until)
                    return (
                      <tr key={shop.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="py-4 pl-6">
                          <span className="font-medium text-sm">{shop.name}</span>
                        </td>
                        <td className="py-4 text-sm text-gray-600">{shop.owner_id}</td>
                        <td className="py-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {banned ? (
                              <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700" title={shop.ban_reason || ''}>
                                Banned s/d {new Date(shop.banned_until as string).toLocaleDateString('id-ID')}
                              </span>
                            ) : (
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                shop.is_verified ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                              }`}>
                                {shop.is_verified ? 'Terverifikasi' : 'Belum'}
                              </span>
                            )}
                            {shop.is_verified && shop.auto_verified && !banned && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-600 font-medium" title="Terverifikasi otomatis oleh sistem karena penjualan tinggi">
                                Auto
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 text-sm">⭐ {shop.rating.toFixed(1)} ({shop.total_reviews})</td>
                        <td className="py-4 text-sm text-gray-600">{shop.total_sold ?? 0}</td>
                        <td className="py-4 text-sm text-gray-600">{new Date(shop.created_at).toLocaleDateString('id-ID')}</td>
                        <td className="py-4 pr-6 text-right">
                          <div className="flex justify-end gap-2 flex-wrap">
                            <button
                              onClick={() => handleToggleShopVerification(shop)}
                              disabled={verifyingShopId === shop.id}
                              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                                shop.is_verified ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-primary-600 text-white hover:bg-primary-700'
                              }`}
                            >
                              {verifyingShopId === shop.id ? 'Memproses...' : shop.is_verified ? 'Batalkan Verifikasi' : 'Verifikasi Manual'}
                            </button>
                            {banned ? (
                              <button onClick={() => handleUnban('shop', shop.id, shop.name)} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200">
                                Cabut Banned
                              </button>
                            ) : (
                              <button onClick={() => openBanModal('shop', shop.id, shop.name)} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200">
                                Banned
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'withdrawals' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
                    <th className="pb-3 pl-6 font-medium">Seller</th>
                    <th className="pb-3 font-medium">Bank</th>
                    <th className="pb-3 font-medium">Nominal</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Tanggal</th>
                    <th className="pb-3 pr-6 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map((withdrawal) => (
                    <tr key={withdrawal.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="py-4 pl-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-medium text-sm">
                            {withdrawal.seller_id[0].toUpperCase()}
                          </div>
                          <span className="font-medium text-sm">{withdrawal.seller_id}</span>
                        </div>
                      </td>
                      <td className="py-4 text-sm">
                        <div>
                          <p className="font-medium">{withdrawal.bank_name}</p>
                          <p className="text-gray-500 text-xs">{withdrawal.account_number}</p>
                        </div>
                      </td>
                      <td className="py-4 text-sm font-medium">{formatCurrency(withdrawal.amount)}</td>
                      <td className="py-4">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          withdrawal.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                          withdrawal.status === 'approved' ? 'bg-green-100 text-green-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {withdrawal.status}
                        </span>
                      </td>
                      <td className="py-4 text-sm text-gray-600">{new Date(withdrawal.created_at).toLocaleDateString('id-ID')}</td>
                      <td className="py-4 pr-6">
                        {withdrawal.status === 'pending' && (
                          <div className="flex gap-2">
                            <button onClick={() => handleApproveWithdrawal(withdrawal.id)} className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-200">
                              Setujui
                            </button>
                            <button onClick={() => handleRejectWithdrawal(withdrawal.id)} className="text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200">
                              Tolak
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'ads' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-sm text-amber-800">
              Sistem hanya memberi tanda &ldquo;Ditandai&rdquo; berdasarkan kata kunci judi online/terlarang dan keterlambatan review 24 jam — ini bukan moderasi otomatis penuh. Keputusan setuju/tolak tetap manual oleh Anda.
            </div>
            {ads.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
                <Megaphone className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-600 text-sm">Belum ada pengajuan iklan</p>
              </div>
            ) : (
              ads.map((ad) => (
                <div key={ad.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row gap-4">
                    <img src={ad.image_url} alt={ad.title} className="w-full sm:w-32 h-32 object-cover rounded-xl flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
                        <h3 className="font-bold text-gray-900">{ad.title}</h3>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          ad.status === 'approved' ? 'bg-green-100 text-green-700' :
                          ad.status === 'rejected' ? 'bg-red-100 text-red-700' :
                          ad.status === 'expired' ? 'bg-gray-100 text-gray-600' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {ad.status === 'pending' ? 'Menunggu Review' : ad.status === 'approved' ? 'Disetujui' : ad.status === 'rejected' ? 'Ditolak' : 'Kedaluwarsa'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{ad.description}</p>
                      <a href={ad.target_url} target="_blank" rel="noreferrer" className="text-xs text-primary-600 hover:underline flex items-center gap-1 mb-2">
                        <ExternalLink size={12} /> {ad.target_url}
                      </a>
                      <div className="text-xs text-gray-500 space-y-0.5">
                        <p>Toko: <span className="font-medium text-gray-700">{ad.shop_name}</span></p>
                        <p>Diajukan oleh: <span className="font-medium text-gray-700">{ad.submitter_username}</span> ({ad.submitter_email})</p>
                        <p>Tanggal: {new Date(ad.created_at).toLocaleString('id-ID')}</p>
                        <p>Batas review: {new Date(ad.review_deadline).toLocaleString('id-ID')}</p>
                      </div>
                      {ad.auto_flagged && (
                        <div className="mt-2 flex items-start gap-1.5 bg-red-50 text-red-700 rounded-lg px-2.5 py-1.5 text-xs">
                          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                          Ditandai: {ad.flag_reason}
                        </div>
                      )}
                      {ad.status === 'rejected' && ad.rejection_reason && (
                        <p className="mt-2 text-xs text-red-600">Alasan ditolak: {ad.rejection_reason}</p>
                      )}

                      {ad.status === 'pending' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => handleApproveAd(ad.id)}
                            disabled={reviewingAdId === ad.id}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
                          >
                            <CheckCircle2 size={14} /> Setujui (7 hari)
                          </button>
                          <button
                            onClick={() => setRejectReasonFor(ad.id)}
                            disabled={reviewingAdId === ad.id}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 flex items-center gap-1"
                          >
                            <XCircle size={14} /> Tolak
                          </button>
                          <button
                            onClick={() => openBanModal('shop', ad.shop_id, ad.shop_name || 'Toko')}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-1"
                          >
                            <Ban size={14} /> Banned Toko
                          </button>
                        </div>
                      )}

                      {rejectReasonFor === ad.id && (
                        <div className="mt-3 flex gap-2">
                          <input
                            className="input-field flex-1 text-sm"
                            placeholder="Alasan penolakan..."
                            value={rejectReasonText}
                            onChange={(e) => setRejectReasonText(e.target.value)}
                          />
                          <button
                            onClick={() => handleRejectAd(ad.id)}
                            disabled={reviewingAdId === ad.id}
                            className="btn-primary text-sm px-4"
                          >
                            Kirim
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'broadcast' && profile?.role === 'owner' && (
          <div className="max-w-2xl bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="flex gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center">
                <Mail size={20} />
              </div>
              <div>
                <h2 className="font-bold">Broadcast</h2>
                <p className="text-sm text-gray-500">Kirim email + notifikasi popup ke seluruh pengguna.</p>
              </div>
            </div>
            <form onSubmit={handleBroadcast} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1.5 block">Tipe Broadcast</label>
                <div className="flex gap-2 flex-wrap">
                  {BROADCAST_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setBroadcast((v) => ({ ...v, type: t.value }))}
                      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                        broadcast.type === t.value ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <input className="input-field" value={broadcast.subject} onChange={(e) => setBroadcast((v) => ({ ...v, subject: e.target.value }))} placeholder="Subjek / Judul" required />
              <textarea className="input-field min-h-40" value={broadcast.body} onChange={(e) => setBroadcast((v) => ({ ...v, body: e.target.value }))} placeholder="Isi pesan" required />

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1.5 block">Gambar (opsional)</label>
                {broadcastImageUrl ? (
                  <div className="relative w-full h-40 rounded-xl overflow-hidden border border-gray-200">
                    <img src={broadcastImageUrl} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setBroadcastImageUrl(null)}
                      className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-lg"
                    >
                      Hapus
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => broadcastImageInputRef.current?.click()}
                    disabled={uploadingBroadcastImage}
                    className="w-full h-24 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-primary-300 hover:text-primary-500 transition-colors disabled:opacity-50"
                  >
                    {uploadingBroadcastImage ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}
                    <span className="text-xs">{uploadingBroadcastImage ? 'Mengunggah...' : 'Unggah gambar langsung'}</span>
                  </button>
                )}
                <input ref={broadcastImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleBroadcastImageChange} />
              </div>

              <button className="btn-primary flex items-center gap-2" disabled={sendingBroadcast}>
                <Mail size={18} />
                {sendingBroadcast ? 'Mengirim…' : 'Kirim broadcast'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Ban Modal */}
      {banTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
                <Ban size={20} />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Banned {banTarget.type === 'user' ? 'User' : 'Toko'}</h3>
                <p className="text-sm text-gray-500">{banTarget.name}</p>
              </div>
            </div>

            <label className="text-xs font-medium text-gray-600 mb-1.5 block">Durasi</label>
            <div className="flex gap-2 flex-wrap mb-4">
              {BAN_DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setBanDurationDays(preset.days)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    banDurationDays === preset.days ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <label className="text-xs font-medium text-gray-600 mb-1.5 block">Alasan</label>
            <textarea
              className="input-field min-h-24 mb-4"
              placeholder="Contoh: melanggar ketentuan iklan judi online"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
            />

            <div className="flex gap-3">
              <button onClick={() => setBanTarget(null)} className="btn-secondary flex-1">Batal</button>
              <button onClick={handleConfirmBan} disabled={submittingBan} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-60">
                {submittingBan ? 'Memproses...' : 'Banned Sekarang'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
