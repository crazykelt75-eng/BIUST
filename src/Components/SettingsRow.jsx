import { useState } from 'react';

export default function SettingRow({ label, value, onSave, type = 'text', options = [] }) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  const handleSave = () => {
    onSave(tempValue);
    setIsEditing(false);
  };

  return (
    <div style={{ marginBottom: '15px', padding: '10px', borderBottom: '1px solid #eee' }}>
      <strong>{label}:</strong>
      {isEditing ? (
        <div>
          {type === 'select' ? (
            <select value={tempValue} onChange={(e) => setTempValue(e.target.value)}>
              {options.map(opt => <option key={opt}>{opt}</option>)}
            </select>
          ) : type === 'checkbox' ? (
            <input type="checkbox" checked={tempValue} onChange={(e) => setTempValue(e.target.checked)} />
          ) : (
            <input type={type} value={tempValue} onChange={(e) => setTempValue(e.target.value)} />
          )}
          <button onClick={handleSave}>Save</button>
          <button onClick={() => setIsEditing(false)}>Cancel</button>
        </div>
      ) : (
        <div>
          <span> {type === 'checkbox' ? (value ? 'Yes' : 'No') : value}</span>
          <button onClick={() => setIsEditing(true)}>Edit</button>
        </div>
      )}
    </div>
  );
}