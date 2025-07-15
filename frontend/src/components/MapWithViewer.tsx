import { useState } from 'react';
import Map from './Map';
import STLViewer from './STLViewer';

export default function MapWithViewer() {
    const [stlBlob, setstlBlob] = useState<Blob | null>(null);

    return (
        <>
            <Map onSTLGenerated={setstlBlob} />
            <STLViewer stlBlob={stlBlob} />
        </>
    )
}