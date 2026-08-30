import React, { useState, useRef, useEffect, useMemo } from 'react';

export interface Option {
  id: string;
  label: string;
  group?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Search...',
  style
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedOption = useMemo(() => options.find(o => o.id === value), [options, value]);

  useEffect(() => {
    // Sync search text with selected value when dropdown is closed
    if (!isOpen) {
      setSearch(selectedOption ? selectedOption.label : '');
    } else {
      setSearch(''); // Clear search on open to show all
    }
  }, [isOpen, selectedOption]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const lowerSearch = search.toLowerCase();
    return options.filter(o => 
      o.label.toLowerCase().includes(lowerSearch) || 
      o.id.toLowerCase().includes(lowerSearch)
    );
  }, [options, search]);

  const groupedOptions = useMemo(() => {
    const groups: Record<string, Option[]> = {};
    filteredOptions.forEach(opt => {
      const g = opt.group || '';
      if (!groups[g]) groups[g] = [];
      groups[g].push(opt);
    });
    return groups;
  }, [filteredOptions]);

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%', ...style }}>
      <input
        type="text"
        value={isOpen ? search : (selectedOption ? selectedOption.label : search)}
        onChange={(e) => {
          setSearch(e.target.value);
          if (!isOpen) setIsOpen(true);
        }}
        onClick={() => setIsOpen(true)}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '0.45rem 2rem 0.45rem 0.5rem',
          fontSize: '0.85rem',
          background: '#0a0a0f',
          color: '#c5c9db',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          outline: 'none',
          fontFamily: 'inherit',
          boxSizing: 'border-box'
        }}
      />
      
      {/* Dropdown caret icon */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'absolute',
          right: '8px',
          top: '50%',
          transform: 'translateY(-50%)',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: '0.7rem',
          pointerEvents: 'none'
        }}
      >
        {isOpen ? '▲' : '▼'}
      </div>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          background: '#0a0a0f',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          maxHeight: '300px',
          overflowY: 'auto',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          padding: '4px'
        }}>
          {filteredOptions.length === 0 ? (
            <div style={{ padding: '8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              No results found
            </div>
          ) : (
            Object.keys(groupedOptions).map(group => (
              <div key={group || 'ungrouped'}>
                {group && (
                  <div style={{
                    padding: '6px 8px 2px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: 'var(--accent)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    {group}
                  </div>
                )}
                {groupedOptions[group].map(opt => (
                  <div
                    key={opt.id}
                    onClick={() => handleSelect(opt.id)}
                    style={{
                      padding: '8px 12px',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      background: opt.id === value ? 'var(--accent-glow)' : 'transparent',
                      color: opt.id === value ? 'var(--text)' : 'var(--text-muted)',
                    }}
                    onMouseEnter={(e) => {
                      if (opt.id !== value) e.currentTarget.style.background = 'oklch(20% 0.01 255.4 / 0.5)';
                    }}
                    onMouseLeave={(e) => {
                      if (opt.id !== value) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {opt.label}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
