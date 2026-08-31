'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Package } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth-provider'
import { Order } from '@/types'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUS_LABELS: Record<Order['status'], string> = {
  pending: 'Menunggu Pembayaran',
  paid: 'Dibayar',
  processing: 'Diproses',
  shipped: 'Dikirim',
  delivered: 'Selesai',
  cancelled: 'Dibatalkan',
}

const PAYMENT_STATUS_LABELS: Record<Order['payment_status'], { label: string; color: string }> = {
  pending: { label: 'Menunggu', color: 'bg-amber-100 text-amber-700' },
  paid: { label: 'Lunas', color: 'bg-green-100 text-green-700' },
  failed: { label: 'Gagal', color: 'bg-red-100 text-red-700' },
  expired: { label: 'Kedaluwarsa', color: 'bg-gray-100 text-gray-600' },
}

export default function SellerOrdersPage() {
  const { user, profile, loading: authLoading } = useAuth()
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user || !profile || !['seller', 'admin', 'owner'].includes(profile.role)) {
      router.replace('/')
      return
    }

    const loadOrders = async () => {
      const { data: shop } = await (supabase as any)
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle()

      if (shop) {
        const { data } = await (supabase as any)
          .from('orders')
          .select('*')
          .eq('shop_id', shop.id)
          .order('created_at', { ascending: false })
        setOrders((data as Order[]) || [])
      }
      setLoading(false)
    }

    loadOrders()
  }, [authLoading, user, profile, router])

  const handleStatusChange = async (orderId: string, status: Order['status']) => {
    setUpdatingId(orderId)
    try {
      const { error } = await (supabase as any)
        .from('orders')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', orderId)

      if (error) throw error

      setOrders((current) => current.map((o) => (o.id === orderId ? { ...o, status } : o)))
      toast.success('Status pesanan berhasil diperbarui')
    } catch (error) {
      console.error('Error updating order status:', error)
      toast.error('Gagal memperbarui status pesanan')
    } finally {
      setUpdatingId(null)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.back()} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Pesanan Toko</h1>
        </div>

        {orders.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
            <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 text-sm">Belum ada pesanan</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const shipping = (order.shipping_address as any) || {}
              const paymentBadge = PAYMENT_STATUS_LABELS[order.payment_status]
              return (
                <div key={order.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="font-medium text-gray-900">#{order.id.slice(0, 8)}</p>
                      <p className="text-sm text-gray-500">{shipping.full_name || 'Pembeli'}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-gray-500">
                          {order.payment_method === 'gorekk' ? 'Pembayaran Online (QRIS)' : 'COD'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${paymentBadge.color}`}>
                          {paymentBadge.label}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-900">{formatCurrency(order.total_amount)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(order.created_at).toLocaleDateString('id-ID')}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <label className="text-xs text-gray-500">Status:</label>
                    <select
                      value={order.status}
                      onChange={(e) => handleStatusChange(order.id, e.target.value as Order['status'])}
                      disabled={updatingId === order.id}
                      className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                    >
                      {(Object.keys(STATUS_LABELS) as Order['status'][]).map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
