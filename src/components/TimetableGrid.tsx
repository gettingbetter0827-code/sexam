import React from 'react';
import { TTData } from '../types';
import { fmtDate } from '../utils/tokens';
import { pad2 } from '../utils/timetable';

interface TimetableGridProps {
  tt: TTData;
}

export const TimetableGrid: React.FC<TimetableGridProps> = ({ tt }) => {
  if (!tt || !tt.entries.length) return null;

  const periods = [...new Set(tt.entries.map((e) => e.period))].sort((a, b) => a - b);

  return (
    <div className="ttwrap">
      <table className="tt">
        <thead>
          <tr>
            <th className="w-16"></th>
            {tt.days.map((d, i) => (
              <th key={d.k}>
                <span className="dn">{i + 1}일차</span>
                {fmtDate(d.date, '짧게')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p}>
              <th>
                <b className="font-bold text-sm">{p}교시</b>
                {tt.bon[p] && <span>{tt.bon[p]}</span>}
              </th>
              {tt.days.map((d, di) => {
                const es = tt.entries
                  .filter((e) => e.day === di && e.period === p)
                  .sort((a, b) => (a.grade || 0) - (b.grade || 0));

                return (
                  <td key={d.k}>
                    {es.map((e, idx) => (
                      <div key={idx} className="te">
                        {e.grade && (
                          <span className={`g g${e.grade}`}>
                            {e.grade}학년
                          </span>
                        )}
                        <span className="s text-xs font-semibold">
                          {e.names.join(' / ') || e.subj}
                        </span>
                        <span className="tm">
                          {e.start ? `${pad2(e.start)}~${pad2(e.end || '')}` : ''}
                          {e.min ? ` · ${e.min}분` : ''}
                        </span>
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
