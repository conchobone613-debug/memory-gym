import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { Panel } from '../components/ui';

/**
 * 자산 = 내가 만들어 두는 것. 훈련(기초·종목)과 층을 나눈다.
 * 만드는 일과 하는 일이 한 줄에 섞여 있으면 지금 뭘 해야 하는지가 흐려진다.
 */
export default function Assets() {
  const images = useLiveQuery(() => db.images.toArray(), [], []);
  const sets = useLiveQuery(() => db.imageSets.toArray(), [], []);
  const palaces = useLiveQuery(() => db.palaces.toArray(), [], []);
  const loci = useLiveQuery(() => db.loci.toArray(), [], []);

  const filled = images.filter((i) => i.name.trim()).length;

  const cards = [
    {
      to: '/assets/sets',
      title: '이미지 세트',
      line: `세트 ${sets.length}개 · 채운 이미지 ${filled} / ${images.length}`,
      desc: '숫자와 카드를 무엇으로 볼지 정해 두는 곳입니다. 모든 훈련이 여기서 나옵니다.',
    },
    {
      to: '/assets/palaces',
      title: '궁전',
      line: `궁전 ${palaces.length}개 · 장소 ${loci.length}개`,
      desc: '외운 이미지를 놓아 둘 자리입니다. 순서가 있는 길이어야 합니다.',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Panel title="자산">
        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className="rounded-xl border border-line bg-panel2 p-4 transition hover:border-accent/60"
            >
              <h3 className="font-semibold">{c.title}</h3>
              <div className="tnum mt-0.5 text-xs text-accent">{c.line}</div>
              <p className="mt-1.5 text-sm text-muted">{c.desc}</p>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}
