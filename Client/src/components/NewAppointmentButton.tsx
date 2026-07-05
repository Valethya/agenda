import React from 'react';
import styles from './Topbar.module.scss';

export const NewAppointmentButton: React.FC = () => {
  const handleNewClick = () => {
    // Redirecciona a la página pública de reservas
    window.location.href = '/';
  };

  return (
    <button className={styles.btnNew} onClick={handleNewClick}>
      + Nueva cita
    </button>
  );
};

export default NewAppointmentButton;
