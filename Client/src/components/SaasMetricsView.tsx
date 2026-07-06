import React, { useEffect, useState } from 'react';
import styles from './SaasMetricsView.module.scss';
import { apiFetch } from '../services/api';

interface Metrics {
  finances: {
    totalRevenue: number;
    totalTransactions: number;
    averageTicket: number;
  };
  users: {
    totalUsers: number;
    breakdown: {
      admin: number;
      worker: number;
      user: number;
      superadmin: number;
    };
  };
  appointments: {
    totalAppointments: number;
    breakdown: {
      pending_payment: number;
      pending: number;
      confirmed: number;
      cancelled: number;
      completed: number;
    };
  };
  topServices: Array<{
    _id: string;
    name: string;
    price: number;
    bookingsCount: number;
  }>;
}

export const SaasMetricsView: React.FC = () => {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch<{ status: string; payload: Metrics }>('/superadmin/metrics');
      if (res && res.status === 'success') {
        setMetrics(res.payload);
      } else {
        setError('Error al cargar las métricas de la plataforma.');
      }
    } catch (err) {
      console.error('Error fetching platform metrics:', err);
      setError('Error de conexión al cargar las métricas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  if (loading) {
    return <div className={styles.loading}>Cargando métricas globales...</div>;
  }

  if (error || !metrics) {
    return (
      <div className={styles.errorContainer}>
        <p className={styles.errorText}>{error || 'Ocurrió un error inesperado'}</p>
        <button onClick={fetchMetrics} className={styles.btnRetry}>Reintentar</button>
      </div>
    );
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(val);
  };

  const { finances, users, appointments, topServices } = metrics;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Métricas Globales SaaS</h2>
        <p className={styles.subtitle}>Análisis financiero y métricas de uso generales de la plataforma agenda.</p>
      </div>

      <div className={styles.grid}>
        {/* Card Financiera */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardIcon}>💵</span>
            <h3 className={styles.cardTitle}>Finanzas Globales</h3>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.metricRow}>
              <span className={styles.label}>Facturación Total:</span>
              <span className={styles.valueHighlight}>{formatCurrency(finances.totalRevenue)}</span>
            </div>
            <div className={styles.metricRow}>
              <span className={styles.label}>Transacciones Totales:</span>
              <span className={styles.value}>{finances.totalTransactions} aprobadas</span>
            </div>
            <div className={styles.metricRow}>
              <span className={styles.label}>Ticket Promedio:</span>
              <span className={styles.value}>{formatCurrency(finances.averageTicket)}</span>
            </div>
          </div>
        </div>

        {/* Card Usuarios */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardIcon}>👥</span>
            <h3 className={styles.cardTitle}>Cuentas de Usuarios</h3>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.metricRow}>
              <span className={styles.label}>Cuentas Totales:</span>
              <span className={styles.valueHighlight}>{users.totalUsers} cuentas</span>
            </div>
            <div className={styles.metricRow}>
              <span className={styles.label}>Clientes (Usuarios):</span>
              <span className={styles.value}>{users.breakdown.user}</span>
            </div>
            <div className={styles.metricRow}>
              <span className={styles.label}>Trabajadores / Especialistas:</span>
              <span className={styles.value}>{users.breakdown.worker}</span>
            </div>
            <div className={styles.metricRow}>
              <span className={styles.label}>Administradores de Negocios:</span>
              <span className={styles.value}>{users.breakdown.admin}</span>
            </div>
          </div>
        </div>

        {/* Card Citas */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardIcon}>📅</span>
            <h3 className={styles.cardTitle}>Reservas Realizadas</h3>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.metricRow}>
              <span className={styles.label}>Citas Totales:</span>
              <span className={styles.valueHighlight}>{appointments.totalAppointments} reservas</span>
            </div>
            <div className={styles.subGrid}>
              <div className={styles.subItem}>
                <span className={styles.subLabel}>Confirmadas:</span>
                <span className={`${styles.subVal} ${styles.confirmed}`}>{appointments.breakdown.confirmed}</span>
              </div>
              <div className={styles.subItem}>
                <span className={styles.subLabel}>Completadas:</span>
                <span className={`${styles.subVal} ${styles.completed}`}>{appointments.breakdown.completed}</span>
              </div>
              <div className={styles.subItem}>
                <span className={styles.subLabel}>Pendientes:</span>
                <span className={`${styles.subVal} ${styles.pending}`}>{appointments.breakdown.pending}</span>
              </div>
              <div className={styles.subItem}>
                <span className={styles.subLabel}>Canceladas:</span>
                <span className={`${styles.subVal} ${styles.cancelled}`}>{appointments.breakdown.cancelled}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabla Top Servicios */}
      <div className={styles.sectionTable}>
        <h3 className={styles.sectionTableTitle}>Top 5 Servicios Más Reservados</h3>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Servicio</th>
                <th>Precio Promedio</th>
                <th style={{ textAlign: 'right' }}>Cantidad de Reservas</th>
              </tr>
            </thead>
            <tbody>
              {topServices.map(s => (
                <tr key={s._id}>
                  <td>{s.name}</td>
                  <td>{formatCurrency(s.price)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{s.bookingsCount}</td>
                </tr>
              ))}
              {topServices.length === 0 && (
                <tr>
                  <td colSpan={3} className={styles.noData}>No hay datos de servicios disponibles.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SaasMetricsView;
