import React from 'react';

interface SidebarIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

const SidebarIcon: React.FC<SidebarIconProps> = ({
  size = 15,
  children,
  strokeWidth = 1.5,
  ...props
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    {children}
  </svg>
);

export const CalendarIcon: React.FC<SidebarIconProps> = props => (
  <SidebarIcon {...props}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </SidebarIcon>
);

export const ClockIcon: React.FC<SidebarIconProps> = props => (
  <SidebarIcon {...props}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15 15" />
  </SidebarIcon>
);

export const UserIcon: React.FC<SidebarIconProps> = props => (
  <SidebarIcon {...props}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
  </SidebarIcon>
);

export const ActivityIcon: React.FC<SidebarIconProps> = props => (
  <SidebarIcon {...props}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </SidebarIcon>
);

export const MonitorIcon: React.FC<SidebarIconProps> = props => (
  <SidebarIcon {...props}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </SidebarIcon>
);

export const ShieldIcon: React.FC<SidebarIconProps> = props => (
  <SidebarIcon {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </SidebarIcon>
);

export const UsersIcon: React.FC<SidebarIconProps> = props => (
  <SidebarIcon {...props}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </SidebarIcon>
);

export const BarChartIcon: React.FC<SidebarIconProps> = props => (
  <SidebarIcon {...props}>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </SidebarIcon>
);

export const BriefcaseIcon: React.FC<SidebarIconProps> = props => (
  <SidebarIcon {...props}>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    <line x1="12" y1="12" x2="12" y2="16" />
    <line x1="10" y1="14" x2="14" y2="14" />
  </SidebarIcon>
);

export const LogoutIcon: React.FC<SidebarIconProps> = props => (
  <SidebarIcon size={16} strokeWidth={2} {...props}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </SidebarIcon>
);
