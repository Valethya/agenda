import React, { useState } from 'react';
import type { CreateSaasBusinessInput } from '../../types';
import styles from '../../components/SaasBusinessesView.module.scss';
import { slugifyBusinessName } from './businessRules';

interface CreateBusinessModalProps {
  onClose: () => void;
  onCreate: (input: CreateSaasBusinessInput) => Promise<boolean>;
}

interface BusinessFormState {
  name: string;
  slug: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerPhone: string;
  ownerPassword: string;
}

const EMPTY_FORM: BusinessFormState = {
  name: '',
  slug: '',
  ownerFirstName: '',
  ownerLastName: '',
  ownerEmail: '',
  ownerPhone: '',
  ownerPassword: ''
};

export const CreateBusinessModal: React.FC<CreateBusinessModalProps> = ({ onClose, onCreate }) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const update = (field: keyof BusinessFormState, value: string) => {
    setForm(previous => ({ ...previous, [field]: value }));
  };

  const handleNameChange = (name: string) => {
    setForm(previous => ({ ...previous, name, slug: slugifyBusinessName(name) }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name || !form.slug || !form.ownerEmail || !form.ownerPassword) {
      alert('Por favor rellena todos los campos obligatorios');
      return;
    }

    setCreating(true);
    const created = await onCreate({
      name: form.name,
      slug: form.slug,
      ownerEmail: form.ownerEmail,
      ownerPassword: form.ownerPassword,
      ownerFirstName: form.ownerFirstName || 'Admin',
      ownerLastName: form.ownerLastName || form.name,
      ownerPhone: form.ownerPhone
    });
    setCreating(false);
    if (created) onClose();
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
          <h3>Registrar Nuevo Negocio</h3>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formSection}>
            <h4>Detalles del Negocio</h4>
            <div className={styles.formGroup}>
              <label>Nombre del Negocio *</label>
              <input
                type="text"
                required
                placeholder="Ej. Barbería VIP"
                value={form.name}
                onChange={event => handleNameChange(event.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label>Slug de acceso *</label>
              <input
                type="text"
                required
                placeholder="ej-barberia-vip"
                value={form.slug}
                onChange={event => update('slug', slugifyBusinessName(event.target.value))}
              />
            </div>
          </div>

          <div className={styles.formSection}>
            <h4>Cuenta del Administrador</h4>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label>Nombre *</label>
                <input type="text" required placeholder="Pedro" value={form.ownerFirstName} onChange={event => update('ownerFirstName', event.target.value)} />
              </div>
              <div className={styles.formGroup}>
                <label>Apellido *</label>
                <input type="text" required placeholder="Barbero" value={form.ownerLastName} onChange={event => update('ownerLastName', event.target.value)} />
              </div>
            </div>
            <div className={styles.formGroup}>
              <label>Email *</label>
              <input type="email" required placeholder="pedro@barberia.com" value={form.ownerEmail} onChange={event => update('ownerEmail', event.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Teléfono *</label>
              <input type="text" required placeholder="+56912345678" value={form.ownerPhone} onChange={event => update('ownerPhone', event.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Contraseña *</label>
              <input type="password" required placeholder="Mínimo 6 caracteres" value={form.ownerPassword} onChange={event => update('ownerPassword', event.target.value)} />
            </div>
          </div>

          <div className={styles.modalActions}>
            <button type="button" className={styles.btnCancel} onClick={onClose}>Cancelar</button>
            <button type="submit" className={styles.btnSubmit} disabled={creating}>
              {creating ? 'Registrando...' : 'Crear Negocio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
