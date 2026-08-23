'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Star, UserPlus, UserCheck, Package, CheckCircle2, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth-provider'
import ProductCard from '@/components/product-card'
import toast from 'react-hot-toast'

export default function SellerProfilePage() {
  const params = useParams()
  const sellerId = params.id as string
  const router = useRouter()
  const { user } = useAuth()

  const [shop, setShop] = useState<any>(null)
  const [seller, setSeller] = useState<any>(null)
  const [products, setProducts] = useState<any[]>([])
  const [isFollowing, setIsFollowing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [followLoading, setFollowLoading] = useState(false)
  const [followerCount, setFollowerCount] = useState(0)

  useEffect(() => {
    loadSellerProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerId])

  const loadSellerProfile = async () => {
    try {
      const { data: sellerData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', sellerId)
        .single()

      if (!sellerData) {
        router.push('/')
        return
      }

      setSeller(sellerData)

      const { data: shopData } = await (supabase as any)
        .from('shops')
        .select('*')
        .eq('owner_id', sellerId)
        .single()

      if (shopData) {
        setShop(shopData)

        const { data: productsData } = await (supabase as any)
          .from('products')
          .select('*')
          .eq('shop_id', shopData.id)
          .eq('is_active', true)
          .order('created_at', { ascending: false })

        setProducts(productsData || [])
      }

      const { count } = await supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', sellerId)

      setFollowerCount(count || 0)

      if (user) {
        const { data: followData } = await supabase
          .from('follows')
          .select('*')
          .eq('follower_id', user.id)
          .eq('following_id', sellerId)
          .maybeSingle()

        setIsFollowing(!!followData)
      }
    } catch (error) {
      console.error('Error loading seller profile:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFollowToggle = async () => {
    if (!user) {
      toast.error('Silakan login terlebih dahulu')
      return
    }

    setFollowLoading(true)
    try {
      if (isFollowing) {
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', sellerId)

        if (error) throw error
        setIsFollowing(false)
        setFollowerCount((c) => Math.max(0, c - 1))
        toast.success('Berhenti mengikuti seller')
      } else {
        const { error } = await (supabase as any)
          .from('follows')
          .insert({
            follower_id: user.id,
            following_id: sellerId,
          })

        if (error) throw error
        setIsFollowing(true)
        setFollowerCount((c) => c + 1)
        toast.success('Berhasil mengikuti seller')
      }
    } catch (error) {
      console.error('Follow error:', error)
      toast.error('Gagal mengubah status mengikuti')
    } finally {
      setFollowLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!shop || !seller) {
    return null
  }

  const isOwnShop = user?.id === sellerId

  const stats = [
    { label: 'Rating', value: (shop.rating || 0).toFixed(1), icon: <Star size={14} className="text-yellow-400 fill-yellow-400" /> },
    { label: 'Ulasan', value: shop.total_reviews || 0 },
    { label: 'Terjual', value: shop.total_sold ?? 0 },
    { label: 'Pengikut', value: followerCount },
  ]

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      {/* Header — sticky, full width, mobile-first */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 -ml-2 rounded-full hover:bg-gray-100 flex-shrink-0">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">{shop.name}</h1>
        </div>
      </div>

      {/* Profile card */}
      <div className="bg-white">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left gap-4">
            {/* Logo */}
            <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gradient-to-br from-primary-500 to-primary-600 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden">
              {shop.logo_url ? (
                <img src={shop.logo_url} alt={shop.name} className="w-full h-full object-cover" />
              ) : (
                <Package size={32} className="text-white" />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 w-full">
              <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap mb-1">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{shop.name}</h1>
                {shop.is_verified && (
                  <ShieldCheck size={20} className="text-primary-600 flex-shrink-0" />
                )}
              </div>
              <p className="text-sm text-gray-600 mb-3 line-clamp-2">{shop.description || 'Toko online terpercaya'}</p>

              {shop.is_verified && (
                <div className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 px-2.5 py-1 rounded-full text-xs font-medium mb-3">
                  <CheckCircle2 size={12} />
                  Toko Terverifikasi
                </div>
              )}

              {!isOwnShop && (
                <button
                  onClick={handleFollowToggle}
                  disabled={followLoading}
                  className={`w-full sm:w-auto px-6 py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60 ${
                    isFollowing
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      : 'bg-primary-600 text-white hover:bg-primary-700'
                  }`}
                >
                  {isFollowing ? (
                    <>
                      <UserCheck size={16} />
                      Sedang Diikuti
                    </>
                  ) : (
                    <>
                      <UserPlus size={16} />
                      Ikuti Toko
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Stats — always visible, tappable-looking grid so followers
              (and rating/sold/reviews) are checkable at a glance instead
              of buried in a paragraph. */}
          <div className="grid grid-cols-4 gap-2 mt-5 pt-5 border-t border-gray-100">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="flex items-center justify-center gap-1 font-bold text-gray-900 text-sm sm:text-base">
                  {stat.icon}
                  {stat.value}
                </div>
                <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Products */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-4">
          Produk Toko <span className="text-gray-400 font-normal text-sm">({products.length})</span>
        </h2>
        {products.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
            <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 text-sm">Belum ada produk</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
