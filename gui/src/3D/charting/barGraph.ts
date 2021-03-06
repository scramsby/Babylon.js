import { Nullable, Scene, Mesh, StandardMaterial, Material, Animation, Observer, Vector3, GlowLayer, Engine, AbstractMesh } from "babylonjs";
import { Chart } from ".";
import { AdvancedDynamicTexture, DisplayGrid } from "../../2D";
import { FluentMaterial } from "../materials";

/** Class used to render bar graphs */
export class BarGraph extends Chart {
    private _margin = 1;
    private _barWidth = 2
    private _maxBarHeight = 10;
    private _defaultMaterial: Nullable<Material>;
    protected _ownDefaultMaterial = false;
    private _barMeshes: Nullable<Array<Mesh>>;
    private _backgroundMesh: Nullable<Mesh>;
    private _backgroundADT : Nullable<AdvancedDynamicTexture>;

    private _pickedPointObserver: Nullable<Observer<Vector3>>;

    private _glowLayer: GlowLayer;
    
    private _onElementEnterObserver: Nullable<Observer<AbstractMesh>>;
    private _onElementOutObserver: Nullable<Observer<AbstractMesh>>;
    
    private _labelDimension: string;

    /** Gets or sets the margin between bars */
    public get margin(): number {
        return this._margin;
    }

    public set margin(value: number) {
        if (this._margin === value) {
            return;
        }

        this._margin = value;

        this.refresh();
    }

    /** Gets or sets the with of each bar */
    public get barWidth(): number {
        return this._barWidth;
    }

    public set barWidth(value: number) {
        if (this._barWidth === value) {
            return;
        }

        this._barWidth = value;

        this.refresh();
    }

    /** Gets or sets the maximum height of a bar */
    public get maxBarHeight(): number {
        return this._maxBarHeight;
    }

    public set maxBarHeight(value: number) {
        if (this._maxBarHeight === value) {
            return;
        }

        this._maxBarHeight = value;

        this.refresh();
    }

    /** Gets or sets the dimension used for the labels */
    public get labelDimension(): string {
        return this._labelDimension;
    }

    public set labelDimension(value: string) {
        if (this._labelDimension === value) {
            return;
        }

        this._labelDimension = value;

        this.refresh();
    }

    /** Gets or sets the material used by bar meshes */
    public get defaultMaterial(): Nullable<Material> {
        return this._defaultMaterial;
    }

    public set defaultMaterial(value: Nullable<Material>) {
        if (this._defaultMaterial === value) {
            return;
        }

        this._defaultMaterial = value;

        this.refresh();
    }

    /**
     * Creates a new BarGraph
     * @param name defines the name of the graph
     * @param scene defines the hosting scene
     */
    constructor(name: string, scene: Nullable<Scene> = Engine.LastCreatedScene) {
        super(name, scene);

        this._glowLayer = new GlowLayer("glow", scene!);

        let activeBar: Nullable<Mesh>;
        this._onElementEnterObserver = this.onElementEnterObservable.add(mesh => {
            activeBar = <Mesh>mesh;
        });

        this._onElementOutObserver = this.onElementOutObservable.add(mesh => {
            activeBar = null;
        });

        this._glowLayer.customEmissiveColorSelector = (mesh, subMesh, material, result) => {
            if (mesh === activeBar) {
                let chartColor = this._dataSource!.color.scale(0.75);
                result.set(chartColor.r, chartColor.g, chartColor.b, 1.0);
            } else {
                result.set(0, 0, 0, 0);
            }
        }
    }

    protected _createDefaultMaterial(scene: Scene): Material {
        var result = new FluentMaterial("fluent", scene);
        result.albedoColor = this._dataSource!.color.scale(0.5);
        result.innerGlowColorIntensity = 0.6;
        result.renderHoverLight = true;
        result.hoverRadius = 5;

        this._pickedPointObserver = this.onPickedPointChangedObservable.add(pickedPoint => {
            if (pickedPoint) {
                result.hoverPosition = pickedPoint;
                result.hoverColor.a = 1.0;
            } else {
                result.hoverColor.a = 0;
            }
        });

        return result;
    }

    /**
     * Children class can override this function to provide a new mesh (as long as it stays inside a 1x1x1 box)
     * @param name defines the mesh name
     * @param scene defines the hosting scene
     * @returns a new mesh used to represent the current bar
     */
    protected _createBarMesh(name: string, scene: Scene): Mesh {
        var box = Mesh.CreateBox(name, 1, scene);
        box.setPivotPoint(new BABYLON.Vector3(0, -0.5, 0));

        box.metadata = "chart";

        return box;
    }

    /** 
     * Force the graph to redraw itself 
     * @returns the current BarGraph
    */
    public refresh(): BarGraph {
        if (this._blockRefresh) {
            return this;
        }

        if (!this._dataSource) {
            this._clean();
            return this;
        }

        let scene = this._rootNode.getScene();

        // Default material
        if (!this._defaultMaterial) {
            this._defaultMaterial = this._createDefaultMaterial(scene);
        }

        // Scan data
        let min = 0;
        let max = Number.MIN_VALUE;

        const data = this._dataFilters ? this._dataSource.getFilteredData(this._dataFilters) : this._dataSource.data;

        // Check the limit of the entire series
        this._dataSource.data.forEach(entry => {
            if (min > entry.value) {
                min = entry.value;
            }

            if (max < entry.value) {
                max = entry.value;
            }
        });

        let ratio = this.maxBarHeight / (max - min);

        let createMesh = false;

        // Do we need to create new graph or animate the current one
        if (!this._barMeshes || this._barMeshes.length !== data.length) {
            this._clean();
            createMesh = true;
            this._barMeshes = [];
        }        

        this.removeLabels();

        // Axis
        if (!this._backgroundMesh) {
            this._backgroundMesh = BABYLON.Mesh.CreatePlane("background", 1, scene);
            this._backgroundMesh.parent = this._rootNode;            
            this._backgroundMesh.setPivotPoint(new BABYLON.Vector3(0, -0.5, 0));

            this._backgroundADT = AdvancedDynamicTexture.CreateForMesh(this._backgroundMesh, 512, 512, false);

            let displayGrid = new DisplayGrid();
            displayGrid.displayMajorLines = false;
            displayGrid.minorLineColor = "White";
            displayGrid.minorLineTickness = 2;
            displayGrid.cellWidth = 512 / data.length;
            displayGrid.cellHeight = 512 / 5;

            this._backgroundADT.addControl(displayGrid);

            (<StandardMaterial>this._backgroundMesh.material!).opacityTexture = null;
        }
        this._backgroundMesh.position.z = this.barWidth;
        this._backgroundMesh.scaling.x = (this.barWidth + this.margin) * data.length;
        this._backgroundMesh.scaling.y = this._maxBarHeight; 

        // We will generate one bar per entry
        let left = -(data.length / 2) * (this.barWidth + this.margin) + 1.5 * this._margin;
        let index = 0;
        data.forEach(entry => {

            var barMesh: Mesh;
            if (createMesh) {
                barMesh = this._createBarMesh(this.name + "_box_" + index++, scene);
                barMesh.enablePointerMoveEvents = true;
                this._barMeshes!.push(barMesh);
            } else {
                barMesh = this._barMeshes![index++];
            }

            barMesh.parent = this._rootNode;
            barMesh.position.x = left;
            let currentScalingYState = barMesh.scaling.y;
            barMesh.scaling.set(this.barWidth, 0, this._barWidth);

            var easing = new BABYLON.CircleEase();
            Animation.CreateAndStartAnimation("entryScale", barMesh, "scaling.y", 30, 30, currentScalingYState, entry.value * ratio, 0, easing);

            barMesh.material = this._defaultMaterial;

            this.onElementCreated.notifyObservers(barMesh);

            left += this.barWidth + this.margin;

            // Label
            if (!this._labelDimension) {
                return;
            }

            let label = this.addLabel(entry[this._labelDimension]);
            label.position = barMesh.position.clone();
            label.position.z -= this.barWidth;
            label.scaling.x = this.barWidth;
        });

        return this;
    }

    /** Clean associated resources */
    public dispose() {
        super.dispose();
        if (this._ownDefaultMaterial && this._defaultMaterial) {
            this._defaultMaterial.dispose();
            this._defaultMaterial = null;
        }

        if (this._backgroundADT) {
            this._backgroundADT.dispose();
            this._backgroundADT = null;
        }

        if (this._pickedPointObserver) {
            this.onPickedPointChangedObservable.remove(this._pickedPointObserver);
            this._pickedPointObserver = null;
        }

        if (this._onElementEnterObserver) {
            this.onElementEnterObservable.remove(this._onElementEnterObserver);
            this._onElementEnterObserver = null;
        }

        if (this._onElementOutObserver) {
            this.onElementOutObservable.remove(this._onElementOutObserver);
            this._onElementOutObserver = null;
        }
    }

    protected _clean(): void {
        super._clean();
        this._barMeshes = null;
        this._backgroundMesh = null;

        if (this._backgroundADT) {
            this._backgroundADT.dispose();
            this._backgroundADT = null;
        }
    }
}