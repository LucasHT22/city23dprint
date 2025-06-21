import { useState } from 'react';
import Map from './Map';
import STLViewer from './STLViewer';

export default function MapWithViewer() {
    const [updateKey, setUpdateKey] = useState(Date.now());
    
    const handleSTLGenerator = () => {
        console.log("New STL!");
        setUpdateKey(Date.now());
    };

    return (
        <>
            <Map onSTLGenerated={handleSTLGenerator} />
            <STLViewer updateKey={updateKey} />
        </>
    )
}