import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Dymo, IndexCard } from '../components/lp';

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

  return (
    <div className="flex flex-col gap-2.5">
      <Dymo className="mb-1 self-start">자산</Dymo>
      <IndexCard
        to="/assets/sets"
        title="이미지 세트"
        meta={`채움 ${filled}/${images.length}`}
        body={`세트 ${sets.length}개 · 숫자와 카드를 무엇으로 볼지 정해 두는 곳입니다. 모든 훈련이 여기서 나옵니다.`}
      />
      <IndexCard
        to="/assets/palaces"
        title="궁전"
        meta={`장소 ${loci.length}개`}
        body={`궁전 ${palaces.length}개 · 외운 이미지를 놓아 둘 자리입니다. 순서가 있는 길이어야 합니다.`}
      />
    </div>
  );
}
