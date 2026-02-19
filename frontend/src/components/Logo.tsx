import React from "react";

interface LogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
}

const Logo: React.FC<LogoProps> = ({ size = 40, className = "", showText = true }) => {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        {/* Dark circle background */}
        <circle cx="32" cy="32" r="30" fill="#111" stroke="#dc2626" strokeWidth="2" />

        {/* Network nodes - representing forensic network analysis */}
        {/* Central node */}
        <circle cx="32" cy="28" r="4" fill="#dc2626" />

        {/* Surrounding nodes */}
        <circle cx="18" cy="20" r="3" fill="#fff" />
        <circle cx="46" cy="20" r="3" fill="#fff" />
        <circle cx="14" cy="36" r="3" fill="#fff" />
        <circle cx="50" cy="36" r="3" fill="#fff" />
        <circle cx="24" cy="46" r="2.5" fill="#dc2626" opacity="0.7" />
        <circle cx="40" cy="46" r="2.5" fill="#dc2626" opacity="0.7" />

        {/* Connection lines */}
        <line x1="32" y1="28" x2="18" y2="20" stroke="#dc2626" strokeWidth="1.5" opacity="0.6" />
        <line x1="32" y1="28" x2="46" y2="20" stroke="#dc2626" strokeWidth="1.5" opacity="0.6" />
        <line x1="32" y1="28" x2="14" y2="36" stroke="#fff" strokeWidth="1" opacity="0.3" />
        <line x1="32" y1="28" x2="50" y2="36" stroke="#fff" strokeWidth="1" opacity="0.3" />
        <line x1="18" y1="20" x2="14" y2="36" stroke="#fff" strokeWidth="1" opacity="0.2" />
        <line x1="46" y1="20" x2="50" y2="36" stroke="#fff" strokeWidth="1" opacity="0.2" />
        <line x1="14" y1="36" x2="24" y2="46" stroke="#dc2626" strokeWidth="1" opacity="0.4" />
        <line x1="50" y1="36" x2="40" y2="46" stroke="#dc2626" strokeWidth="1" opacity="0.4" />
        <line x1="24" y1="46" x2="40" y2="46" stroke="#dc2626" strokeWidth="1" opacity="0.4" />

        {/* Shield overlay — forensic / security badge */}
        <path
          d="M32 12 L40 17 L40 27 Q40 35 32 40 Q24 35 24 27 L24 17 Z"
          fill="none"
          stroke="#dc2626"
          strokeWidth="1.5"
          opacity="0.35"
        />
      </svg>

      {showText && (
        <div>
          <p className="text-xs font-bold leading-none tracking-wide text-white">
            MONEY MULING
          </p>
          <p className="text-[10px] font-medium tracking-widest text-red-500">
            DETECTOR
          </p>
        </div>
      )}
    </div>
  );
};

export default Logo;
